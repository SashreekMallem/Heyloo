/**
 * E.164 phone normalization (CLAUDE.md Rule 2: "Phones normalized to E.164 at
 * every boundary"). Deliberately dependency-free rather than pulling in a
 * full libphonenumber port on the hot path — Heyloo's tenants are US/CA
 * businesses at launch (SYSTEM_DESIGN §1), so the default-country heuristic
 * below covers the real input space (10-digit local, 11-digit with leading
 * 1, or an already-E.164 value from Retell/Twilio) without the dependency
 * weight. Revisit if/when an international vertical ships.
 */

const NON_DIGIT = /\D/g;

/**
 * Normalizes a phone number to E.164 (`+15551234567`). Returns `null` for
 * input that cannot be confidently normalized (never guesses past a nonsense
 * digit count) — callers must treat `null` as "reject/ask again", never
 * silently pass through the raw string.
 */
export function normalizeE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  // Already E.164-looking: leading + followed by 8-15 digits.
  if (/^\+[1-9]\d{7,14}$/.test(trimmed)) return trimmed;

  const digits = trimmed.replace(NON_DIGIT, "");
  if (digits.length === 10) {
    // Bare 10-digit US/CA local number.
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  // International number with a leading 00 dial-out prefix, no + retained.
  if (digits.length >= 8 && digits.length <= 15 && trimmed.startsWith("00")) {
    return `+${digits.slice(2)}`;
  }
  return null;
}

/** True if two phone inputs normalize to the same E.164 value. Used for the
 * `lookup_customer` caller-scope check (G6) — never compare raw strings. */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeE164(a);
  const nb = normalizeE164(b);
  return na !== null && nb !== null && na === nb;
}
