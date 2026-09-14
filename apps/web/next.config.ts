import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { previewModeAliases } from "./src/lib/preview/preview-mode-aliases";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * UI Preview Mode (docs/DESIGN_SYSTEM.md §UI Preview Mode,
 * apps/web/src/lib/preview/README.md): when `UI_PREVIEW_MODE=1` at
 * dev-server/build-start time, the 3 auth session guards every real
 * (tenant)/(admin)/(partner) page and layout imports are swapped for
 * fixture-backed replacements with the SAME exported function signature —
 * real page components render completely unmodified. This is a build-time
 * (not runtime) condition: a production build never sets this env var, so
 * production bundles never see these aliases at all — `(preview)/layout.tsx`
 * also re-checks at request time (`isPreviewModeEnabled()`) as a second,
 * independent guard.
 *
 * Both bundlers are aliased because `next dev` defaults to Turbopack and
 * `next build` in this repo runs `--webpack` (package.json) — whichever is
 * actually active picks up its matching config; the other is inert. The
 * alias TABLE itself (and exactly why webpack additionally needs a
 * resolved-real-source-path entry per mock, on top of the `@/lib/auth/
 * <name>` specifier Turbopack is satisfied with alone) lives in
 * `./src/lib/preview/preview-mode-aliases.ts` — split out of this file so
 * `next.config.test.ts` can unit-test it directly without importing
 * `@sentry/nextjs`/`next-intl` (confirmed: importing this file itself
 * under Vitest throws inside `@sentry/server-utils`' bundler-plugin
 * resolution, an unrelated import-time side effect neither package needs
 * for the alias table's own correctness).
 */
const previewModeActive =
  process.env.UI_PREVIEW_MODE === "1" && process.env.NODE_ENV !== "production";

/**
 * FRONTEND_STACK.md: Vercel Pro, Node serverless (NOT edge runtime) for
 * anything touching Postgres, `preferredRegion` pinned to the Supabase
 * region — set per-route via `export const preferredRegion` (Route
 * Handlers/pages that hit Supabase) rather than globally here, since
 * marketing pages have no such requirement. `SUPABASE_REGION` documents the
 * value to pin (see .env.example) — VERIFY the exact Vercel region code
 * (e.g. `iad1`) against the linked Supabase project's region at deploy time.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@heyloo/ui", "@heyloo/canonical-types", "@heyloo/supabase-client"],
  experimental: {
    // Vercel's fluid-compute pricing model FRONTEND_STACK.md cites depends on
    // this staying on for anything server-rendered per-request.
    serverActions: { bodySizeLimit: "2mb" },
    /**
     * SITE REPAIR finding (blocker): the home route's initial JS pulled
     * in a "dashboard-oriented recharts/date-fns/zod vendor chunk" that
     * marketing has no use for. Root cause: `packages/ui/src/index.ts`
     * is ONE barrel (`export * from "./charts/index.js"` alongside
     * `./primitives`, `./custom`, etc.) — a marketing component doing
     * `import { Button, Container } from "@heyloo/ui"` pulls in that
     * whole barrel's module graph, including the chart components'
     * `recharts`/`date-fns` imports, unless something rewrites the
     * import to reach the individual module directly.
     * `optimizePackageImports` (verified against this exact Next
     * version's shipped docs,
     * node_modules/next/dist/docs/.../optimizePackageImports.md —
     * CLAUDE.md Rule 1) is Next's own documented answer to precisely
     * this "large barrel file" problem: it rewrites a named-import
     * statement against a listed package to import only the modules
     * actually used, with zero call-site change needed. `recharts` and
     * `date-fns` are already in Next's OWN always-on default list (so a
     * *direct* `import {...} from "recharts"` was never the problem) —
     * `@heyloo/ui` itself, a workspace package Next has no built-in
     * knowledge of, needs to be listed explicitly to get the same
     * treatment for its own barrel.
     */
    optimizePackageImports: ["@heyloo/ui"],
  },
  // Image loading strategy (WEBSITE_CREATIVE_BRIEF.md perf budget —
  // "LCP < 2.5s ... assets AVIF/WebP"). Verified against
  // node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md
  // and .../05-config/01-next-config-js/images.md (CLAUDE.md Rule 1 — this
  // app pins `next@16.3.4`, whose docs ship in-repo, so that's the current
  // source of truth rather than a remembered older default):
  //  - `formats` defaults to `["image/webp"]` ONLY — AVIF is opt-in, not a
  //    Next.js default, so it must be listed explicitly to get the smaller
  //    AVIF encode (~20% smaller than WebP per the same doc) for browsers
  //    that support it, with WebP as the automatic fallback (array ORDER
  //    is the preference order the docs describe) and the original format
  //    as the final fallback for anything older.
  //  - `minimumCacheTTL` raised from the 4-hour default to 31 days: the
  //    brief's marketing assets (hero stills, OG image, dashboard-preview
  //    screenshots) are long-lived, hashed-by-content static files, not
  //    frequently-replaced user content — a short TTL only means needless
  //    re-optimization work under `/ _next/image` for no correctness
  //    benefit here.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**.supabase.co" }],
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 2678400,
  },
  // `packages/widget/dist/*.global.js` (the embeddable widget's built
  // bundles) are read from disk at request time by
  // `src/app/widget.js/route.ts` / `src/app/widget-voice.js/route.ts`, NOT
  // `import`ed — Next's build-time output-file tracing only discovers
  // files actually reachable via module imports, so a production
  // (standalone) build would silently omit them without this. `turbo.json`
  // already makes `packages/widget#build` a dependency of `apps/web#build`
  // (`build` depends on `^build`), so the file exists on disk by the time
  // this app builds; this just tells Next's tracer to ship it too.
  outputFileTracingIncludes: {
    "/widget.js": ["../../packages/widget/dist/widget.global.js"],
    "/widget-voice.js": ["../../packages/widget/dist/voice-runtime.global.js"],
  },
  // `UI_PREVIEW_MODE` itself is never sent to the browser (no NEXT_PUBLIC_
  // prefix, read via bracket access in guard.ts) — but
  // `installPreviewFetchMock()` also needs to run client-side (admin/
  // partner `"use client"` hooks call real `fetch()`), and a client
  // bundle can't see server-only env vars. Mirror the ALREADY
  // NODE_ENV-gated `previewModeActive` boolean into a NEXT_PUBLIC_ var so
  // `guard.ts` can check it from the browser too; a production build
  // computes `previewModeActive` as `false` regardless of any env var
  // someone sets, so this always inlines as `"0"` in prod. Dot notation
  // (not bracket) is required for Next's static DefinePlugin inlining —
  // see `node_modules/next/dist/docs/.../config/env.md`.
  env: { NEXT_PUBLIC_UI_PREVIEW_MODE: previewModeActive ? "1" : "0" },
  ...(previewModeActive && {
    turbopack: { resolveAlias: previewModeAliases("turbopack") },
  }),
  ...(previewModeActive && {
    webpack(config) {
      config.resolve ??= {};
      config.resolve.alias = { ...config.resolve.alias, ...previewModeAliases("webpack") };
      return config;
    },
  }),
};

export default withSentryConfig(withNextIntl(nextConfig), {
  silent: true,
  widenClientFileUpload: true,
  // VERIFY (CLAUDE.md Rule 1): org/project slugs come from SENTRY_ORG/
  // SENTRY_PROJECT at build time via the Sentry CLI env vars, not hardcoded
  // here — see .env.example.
  /**
   * Perf budget (docs/DESIGN_SYSTEM.md, `scripts/site-perf/budgets.ts`):
   * re-running the perf-budget script for real (fixing two bugs in
   * `measure.ts` that had been silently masking its own measurement —
   * see that file's history) surfaced the home route's initial JS at
   * ~751KB gz against the brief's 250KB budget, almost entirely
   * `@sentry/nextjs`'s browser bundle (confirmed by grepping the built
   * `.next/static/chunks/*.js` for `sentry-`/`sentry.browser.*` string
   * markers — the two largest chunks, ~292KB and ~147KB gz, are
   * overwhelmingly Sentry). `apps/web/instrumentation-client.ts` (NOT
   * this cluster's file — its own ownership is next.config.ts,
   * layout.tsx's font/preload/theme, globals.css, packages/ui's 4
   * primitives, components/marketing/shared, scripts/site-perf, and the
   * CI perf job only) calls only
   * `Sentry.init({ dsn, tracesSampleRate: 0.1 })` — no
   * `replayIntegration()` anywhere — so every Session Replay
   * tree-shaking flag below is a pure, behavior-unchanged size win (the
   * SDK's own docs: "this has no effect if you did not add
   * replayIntegration"), verified against this exact `@sentry/nextjs`
   * version's shipped `config/types.d.ts` (Rule 1) before adding.
   * `excludeTracing` is deliberately NOT set — `tracesSampleRate: 0.1`
   * means tracing genuinely is in use, and the SDK's own docs warn
   * against tree-shaking it out from under that. The remaining bundle
   * (Sentry's core + tracing/OpenTelemetry) is the actual dominant
   * contributor to the budget miss and is NOT fixable from this file
   * alone — flagged in `docs/BUILD_NOTES.md` (POLISH+PERF) for whoever
   * owns `instrumentation-client.ts` to decide the tracing/bundle-size
   * tradeoff (e.g. a marketing-route-only lazy/no-op init) rather than
   * redesigned here, out of ownership (CLAUDE.md Rule 4).
   */
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludeReplayIframe: true,
    excludeReplayShadowDom: true,
    excludeReplayWorker: true,
  },
});
