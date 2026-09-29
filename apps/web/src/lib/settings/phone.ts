import { z } from "zod";

/**
 * SETTINGS-1 (docs/BUILD_NOTES.md): one strict, friendly phone rule for
 * every owner-entered number in the portal (transfer number, owner alert
 * phone, manager phone, emergency referral / tow partner, owner test phone).
 *
 * Friendly: accepts what an owner actually types — "(610) 555-0122",
 * "610.555.0122", "1-610-555-0122", "+44 20 7946 0958" — and returns E.164.
 * Strict: a +1 number must be a real NANP shape (area code and exchange
 * both start 2-9, 10 digits); any other country code must start 2-9 and
 * have 8-15 digits in total. Anything else (letters, extensions, too few
 * digits, a lone "+1") is rejected rather than stored half-normalized —
 * CLAUDE.md Rule 2: "Phones normalized to E.164 at every boundary."
 */

const NANP_E164 = /^\+1[2-9]\d{2}[2-9]\d{6}$/;
const INTERNATIONAL_E164 = /^\+[2-9]\d{7,14}$/;

export const PHONE_ERROR_MESSAGE =
  "Enter a full phone number, e.g. (610) 555-0122 or +44 20 7946 0958.";

export function normalizePhone(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // Only digits and ordinary phone punctuation — letters (vanity words,
  // "ext 12") are rejected rather than silently dropped.
  if (!/^[+\d\s().\-/]+$/.test(trimmed)) return null;

  const digits = trimmed.replace(/\D/g, "");
  let candidate: string;
  if (trimmed.startsWith("+")) {
    candidate = `+${digits}`;
  } else if (digits.length === 10) {
    candidate = `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    candidate = `+${digits}`;
  } else {
    return null;
  }

  if (candidate.startsWith("+1")) return NANP_E164.test(candidate) ? candidate : null;
  return INTERNATIONAL_E164.test(candidate) ? candidate : null;
}

/** True for a blank value (the field is optional) or a number `normalizePhone` accepts. */
export function isBlankOrValidPhone(raw: string | null | undefined): boolean {
  if (raw == null || raw.trim().length === 0) return true;
  return normalizePhone(raw) !== null;
}

/**
 * Client-side form field: a plain string (react-hook-form keeps input and
 * output shapes equal), blank allowed, otherwise must normalize.
 */
export const zPhoneFormField = z
  .string()
  .trim()
  .max(40)
  .refine((value) => isBlankOrValidPhone(value), PHONE_ERROR_MESSAGE);

/**
 * Server-side boundary: blank / `null` -> `null` (clears the stored value),
 * a missing key stays `undefined` (leave the stored value alone — zod 4
 * runs a transform even for an absent key), anything else -> E.164 or 422.
 */
export const zOptionalPhone = z
  .string()
  .max(40)
  .nullish()
  .transform((value, ctx) => {
    if (value === undefined) return undefined;
    if (value === null || value.trim().length === 0) return null;
    const e164 = normalizePhone(value);
    if (!e164) {
      ctx.addIssue({ code: "custom", message: PHONE_ERROR_MESSAGE });
      return z.NEVER;
    }
    return e164;
  });
