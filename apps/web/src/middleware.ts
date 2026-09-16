import { extractClaims } from "@heyloo/supabase-client";
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
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
  const isApiRoute = request.nextUrl.pathname.startsWith("/api/");
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
  const claims = extractClaims(user?.app_metadata);

  function redirectToLogin() {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith("/dashboard")) {
    if (!user) return redirectToLogin();
    if (!claims.tenant_id) return redirectToWrongRole(request);
  } else if (pathname.startsWith("/cockpit")) {
    if (!user) return redirectToLogin();
    if (!claims.platform_admin) return redirectToWrongRole(request);
    // AAL2 step-up itself is enforced by the (admin) layout (server
    // component, reads `supabase.auth.mfa.getAuthenticatorAssuranceLevel()`
    // — that call needs a full session object middleware's lightweight
    // `getUser()` doesn't fetch) per §0.2; middleware only gates role here.
  } else if (pathname.startsWith("/portal")) {
    if (!user) return redirectToLogin();
    if (!claims.referral_partner_id) return redirectToWrongRole(request);
  } else if (
    pathname.startsWith("/mfa") ||
    pathname === "/login" ||
    pathname.startsWith("/reset-password")
  ) {
    // public
  }

  return response;
}

function redirectToWrongRole(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/";
  url.searchParams.set("toast", "no_access");
  return NextResponse.redirect(url);
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
