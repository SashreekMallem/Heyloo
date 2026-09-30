/**
 * Baseline HTTP security headers for every route (QA-1 F-08).
 *
 * Kept as a plain module (not inlined in `next.config.ts`) so
 * `security-headers.test.ts` can assert on it directly — importing
 * `next.config.ts` under Vitest throws inside `@sentry/server-utils`
 * (see the note above `previewModeActive` in that file).
 *
 * Verified against this app's pinned Next version's shipped docs
 * (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.md`,
 * `.../poweredByHeader.md`, `.../02-guides/content-security-policy.md` —
 * CLAUDE.md Rule 1). No nonce-based CSP: that would force every page to
 * render dynamically and defeat the marketing site's static generation, so
 * the policy uses the docs' documented non-nonce shape (`'unsafe-inline'`
 * for the theme bootstrap / Next's own inline scripts) and ships as
 * REPORT-ONLY first — it can't break a page, and the browser console lists
 * anything a later enforcing policy would block.
 *
 * The widget is a `<script src="/widget.js">` embedded on tenants' own
 * sites and calls `/api/widget/*` cross-origin (fetch, not an iframe), so
 * nothing in this app is ever framed: `frame-ancestors 'none'` and
 * `X-Frame-Options: DENY` apply to every route with no widget exception.
 */
export interface SecurityHeader {
  key: string;
  value: string;
}

const CSP_REPORT_ONLY = [
  "default-src 'self'",
  // Next's inline bootstrap + the no-flash theme script need 'unsafe-inline'
  // without nonces; 'wasm-unsafe-eval' for the demo call's audio codecs.
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://js.stripe.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co",
  "font-src 'self' data:",
  "media-src 'self' blob: https://*.supabase.co",
  // Supabase (REST + Realtime), Sentry ingest, Retell + its LiveKit media
  // transport for the live browser demo.
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://*.ingest.sentry.io https://*.retellai.com https://*.livekit.cloud wss://*.livekit.cloud",
  "worker-src 'self' blob:",
  "frame-src https://js.stripe.com https://checkout.stripe.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com",
  "object-src 'none'",
].join("; ");

export const SECURITY_HEADERS: SecurityHeader[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // microphone=(self): the live browser demo and the dashboard's Test agent
  // page both call getUserMedia; nothing else here needs a powerful feature.
  {
    key: "Permissions-Policy",
    value:
      "microphone=(self), camera=(), geolocation=(), payment=(self), usb=(), interest-cohort=()",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
];

/** The `headers()` result for `next.config.ts`: one rule, every route. */
export function securityHeaderRules(): { source: string; headers: SecurityHeader[] }[] {
  return [{ source: "/:path*", headers: SECURITY_HEADERS }];
}
