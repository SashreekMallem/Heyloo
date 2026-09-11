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
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**.supabase.co" }],
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
});
