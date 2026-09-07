/**
 * HMAC/encoding primitives built on the standard Web Crypto API
 * (`globalThis.crypto.subtle`), available natively in both the Deno Edge
 * Function runtime and Node >=19 — no dependency, so this file is portable
 * and unit-testable under Vitest exactly as it runs in production. Every
 * webhook signature verifier (Retell, Twilio, Stripe — see
 * retell-signature.ts / twilio-signature.ts / stripe-signature.ts) is built
 * from these.
 */

const encoder = new TextEncoder();

export function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function importHmacKey(secret: string, hash: "SHA-256" | "SHA-1"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash }, false, [
    "sign",
  ]);
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await importHmacKey(secret, "SHA-256");
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return toHex(sig);
}

export async function hmacSha1Base64(secret: string, message: string): Promise<string> {
  const key = await importHmacKey(secret, "SHA-1");
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return toBase64(sig);
}

/**
 * Constant-time string comparison. Signature verification must never use
 * `===`/`!==` on attacker-influenceable digests (timing side-channel) — this
 * always walks the full length of the longer string regardless of where the
 * first mismatch is, and folds a length mismatch into the same code path
 * rather than short-circuiting.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < maxLen; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}
