import { demoEmailCaptureSchema } from "@heyloo/canonical-types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * `/demo` "email me this demo" capture (FRONTEND_SPEC.md §3.4 — "inserts
 * into `leads` (`source = 'demo'`) for outreach/CRM continuity").
 *
 * NOT WIRED TO `leads` YET: `public.leads.source` has a DB check
 * constraint of `apollo|outscraper|apify|license_roll` only
 * (`supabase/migrations/20260907130900_outreach.sql`) — there is no
 * `'demo'` value, so this route cannot honestly satisfy the spec's insert
 * without either mislabeling the source or the backend adding the enum
 * value. Flagged in docs/VERIFY.md rather than inserting misleading data;
 * this route validates + accepts the capture and no-ops the persistence
 * until that migration lands. The recap-email send itself also has no
 * specced backend endpoint yet (BACKEND_SPEC names no Resend call for this
 * flow) — same flag.
 */
export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = demoEmailCaptureSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 422 });
  }

  return NextResponse.json({ captured: true });
}
