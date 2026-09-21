import { NextResponse } from "next/server";
import { claimsFromSupabaseClient } from "@/lib/auth/claims";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleServerClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

const SIGNED_URL_TTL_SECONDS = 300; // 5 minutes (DASH-1 brief: 5-10 minutes)

/**
 * DASH-1 (docs/BUILD_NOTES.md): the call-detail page/client
 * (`dashboard/calls/[id]/page.tsx` / `call-detail-client.tsx`) used to pass
 * `call_logs.recording_url`/`stereo_recording_url` — raw object paths in
 * the PRIVATE `recordings` Storage bucket (FINAL-1's flagged gap,
 * `docs/LAUNCH_STATUS.md`) — straight into `<audio src>`, which 404s for
 * every real tenant. This route mints a short-lived signed URL server-side
 * instead, so the bucket path itself never reaches the browser.
 *
 * Auth: the AUTH-1-verified pattern — `claimsFromSupabaseClient` reads
 * `tenant_id` from the caller's own verified JWT `app_metadata` only
 * (never `user.app_metadata`, which the Custom Access Token Hook never
 * writes to — see `lib/auth/claims.ts`'s doc comment). The `call_logs` row
 * is then loaded filtered by BOTH that tenant_id and the requested id
 * (CLAUDE.md Rule 2: every secret-key call still explicitly filters by a
 * verified tenant_id) via the caller's own RLS-enforced session client —
 * a call belonging to a different tenant reads back as no row, same as a
 * nonexistent id, so this route can't be used to probe which ids exist
 * cross-tenant.
 *
 * Signing itself needs the service-role client (Storage's `sign` endpoint
 * has no RLS-equivalent per-caller policy): `createSupabaseServiceRoleClient`
 * (`packages/supabase-client/src/service-role-client.ts`) wraps
 * `@supabase/supabase-js`'s `createClient`, which — per OPS-8's confirmed
 * finding (`docs/VERIFY.md` OPS-8 entry, WebFetch of
 * supabase.com/docs/guides/getting-started/migrating-to-new-api-keys,
 * 2026-09-21) — already sends the new-format `sb_secret_...` key on BOTH
 * `apikey` and `authorization: Bearer` headers by default, the exact
 * combination OPS-8 found necessary against this project's live Storage
 * gateway. No raw `fetch` needed here; `storage.createSignedUrl` rides the
 * same auth OPS-8 verified live for upload/sign against this bucket.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const claims = await claimsFromSupabaseClient(supabase);
  if (!claims.tenant_id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const channel = new URL(request.url).searchParams.get("channel");
  const wantStereo = channel === "stereo";

  const { data: call, error: fetchError } = await supabase
    .from("call_logs")
    .select("id, recording_url, stereo_recording_url")
    .eq("tenant_id", claims.tenant_id)
    .eq("id", id)
    .maybeSingle();
  if (fetchError || !call) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const objectPath = wantStereo ? call.stereo_recording_url : call.recording_url;
  if (!objectPath) {
    return NextResponse.json({ error: "recording_not_available" }, { status: 404 });
  }

  const service = createSupabaseServiceRoleServerClient();
  const { data: signed, error: signError } = await service.storage
    .from("recordings")
    .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
  if (signError || !signed?.signedUrl) {
    return NextResponse.json({ error: "sign_failed" }, { status: 502 });
  }

  return NextResponse.json({
    url: signed.signedUrl,
    expires_in: SIGNED_URL_TTL_SECONDS,
  });
}
