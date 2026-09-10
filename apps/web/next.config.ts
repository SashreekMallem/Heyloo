import { fileURLToPath } from "node:url";
import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

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
 * actually active picks up its matching config; the other is inert.
 *
 * The two bundlers want the alias TARGET in different forms (confirmed by
 * running `UI_PREVIEW_MODE=1 next dev` against this exact config):
 * Turbopack's `resolveAlias` treats a leading `/` as an (unsupported)
 * "server-relative" import and rejects it — it wants a plain path relative
 * to this config file (`./src/...`); webpack's `resolve.alias` wants a
 * real absolute filesystem path.
 */
const PREVIEW_MODE_MOCK_NAMES = [
  "require-tenant-session",
  "require-admin-session",
  "require-partner-session",
] as const;

function previewModeAliases(kind: "turbopack" | "webpack"): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const name of PREVIEW_MODE_MOCK_NAMES) {
    aliases[`@/lib/auth/${name}`] =
      kind === "turbopack"
        ? `./src/lib/preview/mocks/${name}.ts`
        : fileURLToPath(new URL(`./src/lib/preview/mocks/${name}.ts`, import.meta.url));
  }
  return aliases;
}

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
