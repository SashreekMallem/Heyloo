/**
 * Server-only and public env accessors, one place — matches `.env.example`
 * (root). `NEXT_PUBLIC_*` vars are inlined at build time and safe in the
 * browser; the plain `SUPABASE_SECRET_KEY` must never be imported from a
 * file reachable by a Client Component (CLAUDE.md Rule 2 spirit — secrets
 * only via env, server-only). Dot-notation access only (see
 * src/types/env.d.ts) — Next.js's `NEXT_PUBLIC_*` build-time inlining for
 * the browser bundle needs the literal `process.env.NEXT_PUBLIC_X` form.
 */
export const env = {
  get supabaseUrl(): string {
    return process.env.NEXT_PUBLIC_SUPABASE_URL;
  },
  get supabasePublishableKey(): string {
    return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  },
  /** Server-only — Route Handlers/Server Components. Never reference from a Client Component. */
  get supabaseSecretKey(): string {
    return process.env.SUPABASE_SECRET_KEY;
  },
  get appBaseUrl(): string {
    return process.env.APP_BASE_URL ?? "http://localhost:3000";
  },
  get supabaseFunctionsUrl(): string {
    // Supabase Edge Functions live at `${SUPABASE_URL}/functions/v1/...`.
    return `${process.env.SUPABASE_URL}/functions/v1`;
  },
};
