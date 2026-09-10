/**
 * AES-256-GCM at-rest encryption for `adapter_connections.access_token`/
 * `refresh_token` (DB_AUDIT DB-H2), for use from `apps/web`'s Next.js Route
 * Handlers. This is a deliberate byte-for-byte duplicate of
 * `supabase/functions/_shared/crypto.ts`'s `encryptSecret` — NOT a
 * cross-project import, matching this repo's existing build-boundary
 * separation (`apps/web`'s tsconfig uses `moduleResolution: "bundler"` for
 * Next's own webpack/Turbopack resolution; `supabase/functions` is a
 * separately-built Deno project on `NodeNext`). Keep this in sync with that
 * file if the format/algorithm ever changes — same versioned
 * `v1:<base64 iv>:<base64 ciphertext+tag>` output, same
 * `ADAPTER_TOKEN_ENCRYPTION_KEY` (base64-encoded 32-byte key) env var, so
 * `worker-adapter-push`'s `decryptSecret` can read whatever this writes.
 * docs/audit/FIX_REQUESTS.md (requesting cluster: E) — closes DB-H2 for the
 * Airtable OAuth connect/callback flow, the one `adapter_connections`
 * writer cluster E's own fix (api-adapter-connect / worker-adapter-push)
 * could not reach.
 */
const encoder = new TextEncoder();
const AES_GCM_IV_BYTES = 12;
const ENCRYPTED_VALUE_PREFIX = "v1:";

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importAesGcmKey(keyB64: string): Promise<CryptoKey> {
  const raw = fromBase64(keyB64);
  if (raw.byteLength !== 32) {
    // Fail closed (CLAUDE.md Rule 2) — never silently encrypt with a key
    // of the wrong length.
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
