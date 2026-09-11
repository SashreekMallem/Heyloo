import { NextResponse } from "next/server";
import { claimsFromUser } from "@/lib/auth/claims";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Calls list CSV export (FRONTEND_SPEC.md §6.2 DECIDE — "recommend yes, cheap via a Route Handler streaming the same filtered query as CSV"). Streams the caller's own tenant's rows, RLS-enforced. */
export async function GET(request: Request) {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const claims = claimsFromUser(user);
  const tenantId = new URL(request.url).searchParams.get("tenant_id");
  if (!tenantId || tenantId !== claims.tenant_id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data } = await supabase
    .from("call_logs")
    .select("started_at, caller_number, classification, duration_seconds, outcome")
    .eq("tenant_id", tenantId)
    // Voice-only export: exclude the text-agent's shadow rows (channel
    // 'sms'/'web_chat', started_at always null) — same NULLS FIRST hazard
    // as calls-list-client.tsx / overview-client.tsx.
    .in("channel", ["phone", "web_voice"])
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(5000);

  const header = "started_at,caller_number,classification,duration_seconds,outcome";
  const rows = (data ?? []).map((row) =>
    [row.started_at, row.caller_number, row.classification, row.duration_seconds, row.outcome]
      .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
      .join(","),
  );
  const csv = [header, ...rows].join("\n");

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv",
      "content-disposition": "attachment; filename=calls.csv",
    },
  });
}
