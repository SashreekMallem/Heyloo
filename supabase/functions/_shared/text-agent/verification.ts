import { sha256Hex } from "../crypto.ts";

/**
 * Web-chat phone verification (this task's identity rule: "for web chat the
 * customer is unverified → lookup_customer must return nothing until the
 * customer provides and confirms a phone number by SMS code"). A 6-digit
 * code (not an opaque token — the customer types this back manually into
 * the chat widget, so it needs to be short and speakable), hashed at rest
 * the same way every other secret-at-rest value in this codebase is
 * (`sha256Hex`, `_shared/crypto.ts` — never store the code in cleartext,
 * same reasoning as `intake_tokens.token_hash`).
 */

const CODE_LENGTH = 6;
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const MAX_VERIFICATION_ATTEMPTS = 5;

export function generateVerificationCode(): string {
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  const n = (bytes[0] ?? 0) % 10 ** CODE_LENGTH;
  return n.toString().padStart(CODE_LENGTH, "0");
}

export interface PendingVerification {
  codeHash: string;
  expiresAtIso: string;
}

export async function createPendingVerification(
  code: string,
  ttlMs = DEFAULT_TTL_MS,
): Promise<PendingVerification> {
  return {
    codeHash: await sha256Hex(code),
    expiresAtIso: new Date(Date.now() + ttlMs).toISOString(),
  };
}

/** True only if `candidate` (whatever the customer typed) hashes to the
 * stored code AND the code hasn't expired. Never leaks timing beyond
 * `sha256Hex`'s own digest computation (not a secret-comparison hot path —
 * a 6-digit code has fixed structure, so the existing `timingSafeEqual`
 * primitive isn't necessary here; the code space is what limits guessing,
 * bounded further by `verification_attempts`). */
export async function checkVerificationCode(params: {
  candidate: string;
  codeHash: string;
  expiresAtIso: string;
  now?: Date;
}): Promise<boolean> {
  const now = params.now ?? new Date();
  if (new Date(params.expiresAtIso).getTime() <= now.getTime()) return false;
  const candidateHash = await sha256Hex(params.candidate.trim());
  return candidateHash === params.codeHash;
}

/** A message "looks like" a verification-code attempt if it's mostly
 * digits and roughly the right length — used by the engine to short-
 * circuit straight to verification instead of spending an Anthropic call
 * on "123456". Deliberately loose (allows spaces/dashes a customer might
 * type, e.g. "123 456") since a false negative just falls through to the
 * normal engine turn, which handles an incorrect/garbled code gracefully
 * either way. */
export function looksLikeVerificationCode(message: string): boolean {
  const digitsOnly = message.replace(/[\s-]/g, "");
  return /^\d{4,8}$/.test(digitsOnly);
}

export function normalizeCandidateCode(message: string): string {
  return message.replace(/[\s-]/g, "");
}
