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

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Plain (non-HMAC) SHA-256 digest, hex-encoded — used to hash opaque
 * bearer tokens at rest (`api_tokens.token_hash`, single-use intake tokens)
 * so the plaintext token is never stored, only ever compared by re-hashing
 * the presented value (BACKEND_SPEC's `api_tokens` design). */
export async function sha256Hex(message: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(message));
  return toHex(digest);
}

/** A cryptographically random opaque token, URL-safe base64 (no padding).
 * `byteLength` of 32 (default) gives 256 bits of entropy — the same margin
 * as the AES-GCM key this file already generates. */
export function randomOpaqueToken(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return toBase64(bytes.buffer).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
 * AES-256-GCM at-rest encryption for `adapter_connections.access_token`/
 * `refresh_token` (DB_AUDIT DB-H2) — a live third-party credential (OAuth
 * token or paste-key) that must never sit in cleartext where a logical
 * backup, read replica, or any `service_role`-level query could expose it.
 * `ADAPTER_TOKEN_ENCRYPTION_KEY` is a base64-encoded 32-byte key (any env
 * that reads it should generate one with e.g. `openssl rand -base64 32`).
 *
 * Versioned `v1:<base64 iv>:<base64 ciphertext+tag>` format: the prefix
 * lets a future key-rotation/algorithm change coexist with old rows, and
 * `decryptSecret` tolerates a value with NO recognized prefix at all by
 * returning it unchanged — every `adapter_connections` row written before
 * this fix shipped is bare plaintext, and there is no migration in this
 * task's ownership to backfill-encrypt them, so reads must keep working
 * against both shapes until a separate backfill lands.
 */
const AES_GCM_IV_BYTES = 12;
const ENCRYPTED_VALUE_PREFIX = "v1:";

async function importAesGcmKey(keyB64: string): Promise<CryptoKey> {
  const raw = fromBase64(keyB64);
  if (raw.byteLength !== 32) {
    // Fail closed (CLAUDE.md Rule 2) — never silently encrypt/decrypt with
    // a key of the wrong length.
    throw new Error("adapter_token_encryption_key_invalid_length");
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plaintext: string, keyB64: string): Promise<string> {
  const key = await importAesGcmKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );
  return `${ENCRYPTED_VALUE_PREFIX}${toBase64(iv.buffer)}:${toBase64(ciphertext)}`;
}

export async function decryptSecret(value: string, keyB64: string): Promise<string> {
  if (!value.startsWith(ENCRYPTED_VALUE_PREFIX)) {
    // Legacy plaintext row (pre-encryption) — return as-is.
    return value;
  }
  const rest = value.slice(ENCRYPTED_VALUE_PREFIX.length);
  const sepIndex = rest.indexOf(":");
  if (sepIndex === -1) {
    throw new Error("adapter_token_ciphertext_malformed");
  }
  const key = await importAesGcmKey(keyB64);
  const iv = fromBase64(rest.slice(0, sepIndex));
  const ciphertext = fromBase64(rest.slice(sepIndex + 1));
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
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
