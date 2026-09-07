/**
 * Idempotency-key builders. Never check-then-insert (CLAUDE.md Rule 2) — the
 * DB-side unique constraint / GIST exclusion is the race-proofing; these
 * just compute the deterministic key a retried Retell tool-call reproduces
 * byte-for-byte.
 */

/** `bookings.idempotency_key` convention: `call_id:slot_start_iso`
 * (BACKEND_SPEC §1.4). */
export function bookingIdempotencyKey(callId: string, startIso: string): string {
  return `${callId}:${startIso}`;
}

/** Deterministic, order-independent stable stringify — object keys sorted
 * recursively so semantically-identical item arrays (same items, same key
 * order or not) hash identically. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = sortKeysDeep(v);
    return out;
  }
  return value;
}

/** Fast, non-cryptographic FNV-1a 32-bit hash rendered as 8 hex chars.
 * Sufficient for `orders.idempotency_key = call_id + hash(items)`
 * (MASTER_SPEC §3.0) since `call_id` already guarantees per-call
 * uniqueness — this hash only needs to distinguish different item sets
 * within the same call (e.g. a corrected order), not resist collision
 * attacks. Kept synchronous deliberately (vs. crypto.subtle.digest, which is
 * async) so idempotency-key computation never adds an await on the hot path. */
export function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** `orders.idempotency_key` convention: `call_id:fnv1a(stableStringify(items))`
 * (MASTER_SPEC §3.0). */
export function orderIdempotencyKey(callId: string, items: unknown): string {
  return `${callId}:${fnv1aHex(stableStringify(items))}`;
}
