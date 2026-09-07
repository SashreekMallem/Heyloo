import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

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
};

export default withSentryConfig(withNextIntl(nextConfig), {
  silent: true,
  widenClientFileUpload: true,
  // VERIFY (CLAUDE.md Rule 1): org/project slugs come from SENTRY_ORG/
  // SENTRY_PROJECT at build time via the Sentry CLI env vars, not hardcoded
  // here — see .env.example.
});
