import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { sessionAssuranceFromSupabaseClient } from "./lib/auth/claims";
import { NO_ACCESS_PATH, roleHome } from "./lib/auth/role-home";
import { sameOriginPath } from "./lib/auth/same-origin-path";
import { env } from "./lib/env";

const intlMiddleware = createIntlMiddleware(routing);

/**
 * `middleware.ts` — guard #1 of the two enforced in defense-in-depth
 * (FRONTEND_SPEC.md §0.1): matches on path prefix, redirects before any
 * render if a role/claim is wrong or missing. Each route group's root
 * `layout.tsx` re-checks (guard #2, the real backstop — middleware can be
 * bypassed by a direct RSC fetch in some edge configs).
 *
 * Composition: next-intl's own middleware resolves the locale first (its
 * response may itself be a redirect, e.g. adding a locale prefix); the
 * Supabase session refresh + role guard then run against that same
 * response so its Set-Cookie headers are preserved either way.
 */
export async function middleware(request: NextRequest) {
  // Route Handlers live outside `[locale]` and must never go through
  // next-intl — it rewrites every unprefixed path to `/en/...` even in
  // "as-needed" mode, which 404s every `/api/*` route in a production
  // build (confirmed empirically against `next start`; dev's on-demand
  // compilation papers over it). See docs/BUILD_NOTES.md T5 entry.
  // `/auth/confirm` (QA-PORTAL) is the same story as `/api/*` above — a
  // Route Handler living outside `[locale]` that GoTrue redirects real
  // users to directly (their email client, not our own locale-aware
  // nav), so it must bypass next-intl's rewrite too.
  const isApiRoute =
    request.nextUrl.pathname.startsWith("/api/") || request.nextUrl.pathname.startsWith("/auth/");
  const intlResponse = isApiRoute ? undefined : intlMiddleware(request);
  const response = intlResponse ?? NextResponse.next({ request });
  // No Server Component API exposes the current request pathname directly
  // (only Client Components get `usePathname()`) — this header is how the
  // (partner) layout tells "am I already on /portal/disclosure" apart from
  // every other portal page, to avoid a redirect loop (FRONTEND_SPEC §8.4).
  response.headers.set("x-pathname", request.nextUrl.pathname);

  const supabase = createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = withoutLocalePrefix(request.nextUrl.pathname);
  // SIGNUP-1 fix (docs/BUILD_NOTES.md): `user.app_metadata` never carries
  // the Custom Access Token Hook's tenant_id/role/platform_admin/
  // referral_partner_id — only the JWT's own claims do. `getClaims()`
  // (verified, falls back to {} on no/invalid session) is the correct read.
  // SEC-01: `platform_admin` exists only on an aal2 token; a platform admin
  // below aal2 carries the inert `admin_mfa_required` marker instead.
  const { claims, adminMfaRequired } = await sessionAssuranceFromSupabaseClient(supabase);

  /** AUTH-12: the requested path WITHOUT the locale prefix, query included, so a deep link survives login intact. */
  const requestedPath = pathname + request.nextUrl.search;

  function redirectToLogin() {
    // A fresh URL, not a clone of the request URL: cloning kept the original
    // query (`/login?x=1&next=...`) and, for a locale-prefixed request, put
    // the prefixed pathname in `next`.
    const url = new URL("/login", request.url);
    url.searchParams.set("next", requestedPath);
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith("/dashboard")) {
    if (!user) return redirectToLogin();
    if (!claims.tenant_id) return redirectToNoAccess(request);
  } else if (pathname.startsWith("/cockpit")) {
    if (!user) return redirectToLogin();
    if (!claims.platform_admin && !adminMfaRequired) return redirectToNoAccess(request);
    if (!claims.platform_admin) {
      // AUTH-11 / COCKPIT-F19: a password-only (aal1) admin is stepped up
      // here, where the real requested path is known, so the challenge
      // returns them to /cockpit/tenants rather than always /cockpit.
      // `getAuthenticatorAssuranceLevel()` reads the session locally:
      // nextLevel is aal2 iff a verified factor exists.
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const target = aal?.nextLevel === "aal2" ? "/mfa/challenge" : "/mfa/enroll";
      const url = new URL(target, request.url);
      if (target === "/mfa/challenge") url.searchParams.set("next", requestedPath);
      return NextResponse.redirect(url);
    }
    // A stale aal1 token that still carries the legacy `platform_admin`
    // claim is stepped up by the (admin) layout's requireAdminSession, which
    // reads the session's real assurance level (guard #2).
  } else if (pathname.startsWith("/portal")) {
    if (!user) return redirectToLogin();
    if (!claims.referral_partner_id) return redirectToNoAccess(request);
  } else if (pathname === "/login") {
    // AUTH-09: an already-signed-in visitor has no business on the login
    // form. Honour a safe `next`, otherwise the role home. A failed email
    // link (`?toast=confirm_failed`) still gets to show its explanation.
    if (user && request.nextUrl.searchParams.get("toast") !== "confirm_failed") {
      const next = sameOriginPath(request.nextUrl.searchParams.get("next"), request.nextUrl.origin);
      return NextResponse.redirect(
        new URL(next ?? roleHome(claims, { adminMfaRequired }), request.url),
      );
    }
  }
  // `/mfa/*` and `/reset-password*` are public here (they run their own checks).

  return response;
}

function redirectToNoAccess(request: NextRequest) {
  // AUTH-05: a signed-in user who lacks the role/workspace for the route
  // goes to a real explanation page (next steps + log out), not the
  // marketing home with a toast that vanishes.
  return NextResponse.redirect(new URL(NO_ACCESS_PATH, request.url));
}

function withoutLocalePrefix(pathname: string): string {
  for (const locale of routing.locales) {
    if (pathname === `/${locale}`) return "/";
    if (pathname.startsWith(`/${locale}/`)) return pathname.slice(locale.length + 1);
  }
  return pathname;
}

export const config = {
  matcher: [
    // Skip Next internals and static assets; run on everything else
    // (marketing pages included, so the intl middleware can locale-route
    // them too — auth guards above are no-ops for those paths).
    // `widget.js` / `widget-voice.js` are the embeddable widget bundles
    // served by their own route handlers (src/app/widget.js/route.ts). They
    // MUST be excluded: next-intl locale-routes anything the matcher
    // catches, so `/widget.js` was being rewritten to `/en/widget.js` and
    // returning the localized 404 page on Vercel (caught on the first live
    // deployment, 2026-09-16) — every embedded widget would fail to load.
    "/((?!_next/static|_next/image|favicon.ico|widget\\.js|widget-voice\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
