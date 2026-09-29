/**
 * The public origin of the marketing site, for absolute URLs in the sitemap,
 * robots.txt, RSS feed and Open Graph tags. `APP_BASE_URL` is the source of
 * truth (documented in .env.example); on Vercel the production domain is the
 * fallback so an unset variable never yields `localhost` in production.
 * No trailing slash.
 */
export function siteUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env["APP_BASE_URL"]?.trim();
  const vercel = env["VERCEL_PROJECT_PRODUCTION_URL"]?.trim();
  const raw = explicit || (vercel ? `https://${vercel}` : "http://localhost:3000");
  return raw.replace(/\/+$/, "");
}

/** Paths crawlers must not index: app surfaces, auth screens and the API. */
export const ROBOTS_DISALLOW = [
  "/dashboard",
  "/cockpit",
  "/portal",
  "/api/",
  "/auth/",
  "/mfa",
  "/login",
  "/reset-password",
  "/signup/",
  "/intake/",
] as const;
