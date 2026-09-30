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
 * `X-Frame-Options: DENY` apply to every page route. The two widget script
 * routes are left out of that rule only because a script response has no
 * framing semantics either way (AUTH-13).
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

/** Sent on every route, including the embeddable widget bundles. */
const BASELINE_HEADERS: SecurityHeader[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // microphone=(self): the live browser demo and the dashboard's Test agent
  // page both call getUserMedia; nothing else here needs a powerful feature.
  {
    key: "Permissions-Policy",
    value:
      "microphone=(self), camera=(), geolocation=(), payment=(self), usb=(), interest-cohort=()",
  },
  // Vercel also adds HSTS at the edge; this covers any other host (AUTH-13).
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

/**
 * Page-level policy: anti-framing plus the report-only CSP. Not sent on the
 * two embeddable widget bundles, which are `<script src>` responses with no
 * framing semantics (AUTH-13: they carry no anti-framing rule).
 */
const PAGE_HEADERS: SecurityHeader[] = [
  { key: "X-Frame-Options", value: "DENY" },
  // The one directive that is safe to ENFORCE without a nonce pipeline: it is
  // what actually stops framing in browsers that prefer CSP over X-Frame-Options
  // (AUTH-13). The rest of the policy stays report-only below.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
];

/** Every header this app sets on a page route. */
export const SECURITY_HEADERS: SecurityHeader[] = [...BASELINE_HEADERS, ...PAGE_HEADERS];

/** Embeddable widget bundles (`src/app/widget.js/route.ts`), excluded from the page rule. */
const EMBEDDABLE = "widget\\.js|widget-voice\\.js";

/** The `headers()` result for `next.config.ts`: a baseline for every route, page policy for all but the widget bundles. */
export function securityHeaderRules(): { source: string; headers: SecurityHeader[] }[] {
  return [
    { source: "/:path*", headers: BASELINE_HEADERS },
    { source: `/((?!${EMBEDDABLE}).*)`, headers: PAGE_HEADERS },
  ];
}
