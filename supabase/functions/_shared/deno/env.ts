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

/** Central catalog of every env var edge functions read, so a missing one
 * fails at cold-start with a clear name instead of a deep-in-a-handler
 * `undefined`. Each function's index.ts only calls `requireEnv`/`optionalEnv`
 * for the vars IT actually needs — this list is documentation, not a
 * blanket eager-load (a function that doesn't touch Stripe shouldn't fail
 * cold-start over a missing Stripe secret). See .env.example (T0) for the
 * authoritative comment-per-var source; kept in sync here for the subset
 * this package reads. */
export const ENV_VAR_NAMES = {
  supabaseDbUrl: "SUPABASE_DB_URL",
  supabaseUrl: "SUPABASE_URL",
  supabaseServiceRoleKey: "SUPABASE_SECRET_KEY",
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
