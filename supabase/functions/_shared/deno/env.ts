// Deno-only glue (excluded from ../../tsconfig.json — see
// supabase/functions/BUILD_NOTES.md). Every secret/URL edge functions need,
// read fail-closed: a missing required var throws at cold-start rather than
// silently proceeding with `undefined` (CLAUDE.md Rule 2 — "missing secret =
// reject, never skip").

export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  return Deno.env.get(name) ?? undefined;
}

/**
 * Names from `names` that are unset (empty string counts as unset, matching
 * `requireEnv`'s own falsy check). Used by scheduled jobs whose OPTIONAL
 * integration secret(s) may not be configured yet (OPS-1, docs/BUILD_NOTES.md):
 * the cron-secret auth check still runs (and still fail-closed via
 * `requireEnv`) before this is ever consulted, but a job that has nothing to
 * do without an unset integration secret returns an explicit
 * `{ skipped: "not_configured" }` 200 instead of crashing cold-start with
 * `Missing required env var: X` every few minutes.
 */
export function missingEnv(names: readonly string[]): string[] {
  return names.filter((name) => !Deno.env.get(name));
}

/** Central catalog of every env var edge functions read, so a missing one
 * fails at cold-start with a clear name instead of a deep-in-a-handler
 * `undefined`. Each function's index.ts only calls `requireEnv`/`optionalEnv`
 * for the vars IT actually needs — this list is documentation, not a
 * blanket eager-load (a function that doesn't touch Stripe shouldn't fail
 * cold-start over a missing Stripe secret). See .env.example (T0) for the
 * authoritative comment-per-var source; kept in sync here for the subset
 * this package reads. */
/**
 * Service-role key for admin REST calls. Supabase injects
 * `SUPABASE_SECRET_KEYS` (a JSON dictionary keyed by API-key name, e.g.
 * `{"default":"sb_secret_..."}`) into every function automatically
 * (supabase.com/docs/guides/functions/secrets, verified 2026-09-16), so no
 * hand-set secret is needed. `SB_SECRET_KEY` is still honoured first as an
 * explicit override (custom secrets cannot start with `SUPABASE_`).
 */
export function optionalServiceRoleKey(): string | undefined {
  const explicit = Deno.env.get("SB_SECRET_KEY");
  if (explicit) return explicit;
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!raw) return undefined;
  try {
    const dict = JSON.parse(raw) as Record<string, unknown>;
    const candidate = dict.default ?? Object.values(dict)[0];
    return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
  } catch {
    return undefined;
  }
}

export function requireServiceRoleKey(): string {
  const key = optionalServiceRoleKey();
  if (!key) {
    throw new Error(
      "Missing service-role key: SUPABASE_SECRET_KEYS was not provided by the platform and no SB_SECRET_KEY override is set",
    );
  }
  return key;
}

export const ENV_VAR_NAMES = {
  supabaseDbUrl: "SUPABASE_DB_URL",
  supabaseUrl: "SUPABASE_URL",
  supabaseServiceRoleKey: "SB_SECRET_KEY",
  retellApiKey: "RETELL_API_KEY",
  retellWebhookSecret: "RETELL_WEBHOOK_SIGNING_SECRET",
  twilioAccountSid: "TWILIO_ACCOUNT_SID",
  twilioAuthToken: "TWILIO_AUTH_TOKEN",
  stripeSecretKey: "STRIPE_SECRET_KEY",
  stripeWebhookSecret: "STRIPE_WEBHOOK_SIGNING_SECRET",
  paypalClientId: "PAYPAL_CLIENT_ID",
  paypalClientSecret: "PAYPAL_CLIENT_SECRET",
  outreachWebhookSecret: "OUTREACH_WEBHOOK_SECRET",
  squareWebhookSignatureKey: "SQUARE_WEBHOOK_SIGNATURE_KEY",
  resendApiKey: "RESEND_API_KEY",
  geocodeApiKey: "GEOCODE_API_KEY",
  adminSessionAal2WindowMinutes: "ADMIN_AAL2_FRESHNESS_MINUTES",
} as const;
