import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * `/auth/confirm` — QA-PORTAL root-cause fix. Every GoTrue email link
 * (team invite, signup confirmation, password recovery) redirects the
 * browser to `<redirectTo>?token_hash=<hash>&type=<EmailOtpType>` — never
 * to a URL that already carries a session. RETELL^H^H^HSUPABASE-VERIFIED
 * against the CURRENT supabase.com/docs/guides/auth/server-side/
 * email-based-auth-with-pkce-flow-for-ssr (fetched live this session,
 * docs/VERIFY.md QA-PORTAL entry): the documented fix for an App Router
 * SSR client is exactly this route — call `auth.verifyOtp({type,
 * token_hash})` server-side (which both verifies AND establishes the
 * session, writing the `@supabase/ssr` cookies), then redirect to `next`.
 *
 * Before this route existed, NOTHING in this repo ever called `verifyOtp`
 * or `exchangeCodeForSession` — every email-link flow (`api-team-invite`'s
 * `redirectTo: '<APP_BASE_URL>/dashboard'`, `reset-password/page.tsx`'s
 * `redirectTo: '<origin>/reset-password/confirm'`) sent the user straight
 * to a page assuming a session that was never established: `/dashboard`
 * redirects an unauthenticated visitor straight to `/login` via
 * `middleware.ts` (the `token_hash`/`type` params are silently dropped),
 * and `/reset-password/confirm` called `auth.updateUser({password})`
 * with no session at all (`Auth session missing!`). A team invite could
 * never actually be accepted, and a password reset could never actually
 * complete, for any real user — confirmed live this session (QA-PORTAL,
 * docs/BUILD_NOTES.md): the GoTrue call itself failed closed on the
 * shared project's mailer rate limit before reaching this gap, but the
 * gap is real and independent of that limit (reasoned from the actual
 * `@supabase/auth-js@2.116.0` GoTrueClient source: PKCE's client-side
 * auto-exchange throws `AuthPKCECodeVerifierMissingError` for a `code=`
 * link opened in a browser that never held the verifier — which every
 * invite recipient's browser necessarily is — and GoTrue's own
 * `token_hash`-based invite/recovery links were never consumed by
 * anything at all).
 *
 * `next` is trusted only as a same-origin relative path (never an
 * absolute/external URL) to avoid turning this into an open redirect.
 */
const VALID_TYPES = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
]);

function safeNext(raw: string | null, fallback: string): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  return raw;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const next = safeNext(url.searchParams.get("next"), "/dashboard");
  const errorRedirect = new URL("/login", url.origin);
  errorRedirect.searchParams.set("toast", "confirm_failed");

  if (!tokenHash || !type || !VALID_TYPES.has(type as EmailOtpType)) {
    return NextResponse.redirect(errorRedirect);
  }

  const supabase = await createSupabaseServerComponentClient();
  const { error } = await supabase.auth.verifyOtp({
    type: type as EmailOtpType,
    token_hash: tokenHash,
  });
  if (error) {
    return NextResponse.redirect(errorRedirect);
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
