import { toBase64 } from "../crypto.ts";

/**
 * OUTBOUND-1: a new destination signing secret, Standard Webhooks
 * serialization (spec/standard-webhooks.md "Signature scheme"): random
 * bytes, 24-64 of them, base64 encoded and prefixed `whsec_`. 32 bytes here.
 * The plaintext is returned to the owner exactly once (create / rotate) and
 * stored only in Supabase Vault (`fn_outbound_secret_create`).
 */
export const SIGNING_SECRET_BYTES = 32;
export const SIGNING_SECRET_PREFIX = "whsec_";

export function generateSigningSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SIGNING_SECRET_BYTES));
  return `${SIGNING_SECRET_PREFIX}${toBase64(bytes.buffer)}`;
}
