/**
 * Baseline security response headers (AUTH-13). The app previously emitted
 * none: `/login` and the dashboards could be framed by any site
 * (clickjacking) and MIME sniffing / referrer leakage were left at browser
 * defaults. Used by `next.config.ts` `headers()`
 * (node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.md).
 *
 * Deliberately NOT a full Content-Security-Policy: Next injects inline
 * bootstrap scripts, so a script-src policy needs a nonce pipeline of its own.
 * `frame-ancestors` is the one CSP directive that is safe to ship on its own
 * and is what stops framing.
 *
 * Nothing here is framed by design: the embeddable widget is a script
 * (`/widget.js`, `/widget-voice.js`) that talks to `/api/widget/*` over fetch,
 * not an iframe, so those two script routes are simply left out of the
 * framing rule (a script response has no framing semantics either way).
 */
export interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

/** Embeddable widget bundles, excluded from the anti-framing rule. */
const EMBEDDABLE = "widget\\.js|widget-voice\\.js";

export function securityHeaderRules(): HeaderRule[] {
  return [
    {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        // The live demo and the tenant test-agent use the microphone on our
        // own origin; nothing needs camera or location.
        { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=()" },
        // Vercel also adds HSTS at the edge; this covers any other host.
        { key: "Strict-Transport-Security", value: "max-age=31536000" },
      ],
    },
    {
      source: `/((?!${EMBEDDABLE}).*)`,
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      ],
    },
  ];
}
