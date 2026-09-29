import { NextResponse } from "next/server";
import { claimsFromSupabaseClient } from "@/lib/auth/claims";
import { csvRow } from "@/lib/calls/csv";
import {
  buildCallOrFilter,
  parseCallSearch,
  parseClassification,
  parseIsoInstant,
} from "@/lib/calls/filters";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Calls list CSV export (FRONTEND_SPEC.md §6.2 DECIDE — "recommend yes, cheap via a Route Handler streaming the same filtered query as CSV"). Streams the caller's own tenant's rows, RLS-enforced.
 *
 * Applies the SAME filters as the Calls page (QA-1 F-17): `classification`,
 * `q` (number / customer-name search) and the `started_after` /
 * `started_before` instants (the page computes them from the tenant-local
 * from/to dates). Every cell is formula-injection-safe (`csvCell`).
 */
export async function GET(request: Request) {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // AUTH-1 fix (docs/BUILD_NOTES.md, SIGNUP-1 root cause #3): claims live
  // only in the JWT itself, never in the User/session object's
  // app_metadata; claimsFromUser(user) always evaluated to {} for a real
  // tenant/admin/partner here.
  const claims = await claimsFromSupabaseClient(supabase);
  const params = new URL(request.url).searchParams;
  const tenantId = params.get("tenant_id");
  if (!tenantId || tenantId !== claims.tenant_id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const classification = parseClassification(params.get("classification"));
  const startedAfter = parseIsoInstant(params.get("started_after"));
  const startedBefore = parseIsoInstant(params.get("started_before"));
  const search = (params.get("q") ?? "").trim();

  // Number / name search — identical resolution to the Calls page: digits match
  // `caller_number`, letters match customers' names -> their E.164 numbers.
  let orFilter: string | null = null;
  if (search) {
    const term = parseCallSearch(search);
    let phones: string[] = [];
    if (term.namePattern) {
      const { data: customers } = await supabase
        .from("customers")
        .select("phone_e164")
        .eq("tenant_id", tenantId)
        .ilike("name", term.namePattern)
        .limit(50);
      phones = (customers ?? []).map((c) => c.phone_e164);
    }
    orFilter = buildCallOrFilter(term, phones);
  }

  const header = "started_at,caller_number,classification,duration_seconds,outcome";
  let rows: string[] = [];

  // A search that can match nothing exports just the header (never everything).
  if (!search || orFilter) {
    let q = supabase
      .from("call_logs")
      .select("started_at, caller_number, classification, duration_seconds, outcome")
      .eq("tenant_id", tenantId)
      // Voice-only export: exclude the text-agent's shadow rows (channel
      // 'sms'/'web_chat', started_at always null) — same NULLS FIRST hazard
      // as calls-list-client.tsx / overview-client.tsx.
      .in("channel", ["phone", "web_voice"]);
    if (classification) q = q.eq("classification", classification);
    if (startedAfter) q = q.gte("started_at", startedAfter);
    if (startedBefore) q = q.lt("started_at", startedBefore);
    if (orFilter) q = q.or(orFilter);
    const { data, error } = await q
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(5000);
    if (error) return NextResponse.json({ error: "export_failed" }, { status: 500 });
    rows = (data ?? []).map((row) =>
      csvRow([
        row.started_at,
        row.caller_number,
        row.classification,
        row.duration_seconds,
        row.outcome,
      ]),
    );
  }

  const csv = [header, ...rows].join("\n");

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv",
      "content-disposition": "attachment; filename=calls.csv",
    },
  });
}
