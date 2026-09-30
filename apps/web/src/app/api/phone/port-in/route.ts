import { phonePortInRequestSchema } from "@heyloo/canonical-types";
import { NextResponse } from "next/server";
import { claimsFromSupabaseClient } from "@/lib/auth/claims";
import { normalizePhone, PHONE_ERROR_MESSAGE } from "@/lib/settings/phone";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Phone setup → port-in (FRONTEND_SPEC.md §6.7). No dedicated port-in
 * table/edge function exists yet in the backend (docs/VERIFY.md) — this
 * records the request as a `support_requests` row (an async, human-
 * followed-up request is exactly that table's paper-trail shape) rather
 * than inventing a new table in a package outside T5's exclusive paths.
 *
 * QA-1 F-15: `current_number` is stored as E.164 (422 with a `current_number`
 * issue otherwise), and there is no PIN: the ticket body is readable text, so
 * support collects the carrier PIN securely once the port starts.
 */
export async function POST(request: Request) {
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
  if (!claims.tenant_id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = phonePortInRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const currentNumber = normalizePhone(parsed.data.current_number);
  if (!currentNumber) {
    return NextResponse.json(
      {
        error: "invalid_request",
        issues: [{ path: ["current_number"], message: PHONE_ERROR_MESSAGE }],
      },
      { status: 422 },
    );
  }

  const { error } = await supabase.from("support_requests").insert({
    tenant_id: claims.tenant_id,
    subject: "Phone number port-in request",
    body: `Carrier: ${parsed.data.carrier}\nCurrent number: ${currentNumber}\nAccount number: ${parsed.data.account_number}\nAccount PIN: not collected here, ask the customer securely.`,
    priority: "medium",
    created_by: user.id,
  });

  if (error) return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  return NextResponse.json({ requested: true });
}
