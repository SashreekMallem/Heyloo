/**
 * Low-level canonical primitives shared across every schema in this package:
 * money (integer cents, CLAUDE.md Rule 2 — "money in integer cents"), phone
 * numbers (E.164, "phones normalized to E.164 at every boundary"), and ISO
 * timestamps (timestamptz on the wire is always an ISO-8601 string with an
 * explicit offset).
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Money — integer cents only. Never a float dollar amount anywhere canonical.
// ---------------------------------------------------------------------------

/** Branded integer-cents type — nominal enough to catch `price / 100` style bugs at the type level. */
export type Cents = number & { readonly __brand: "Cents" };

/** Non-negative integer cents (the common case: prices, totals, fees). */
export const zCents = z
  .number()
  .int("cents must be an integer — never a fractional-cent amount")
  .nonnegative("cents must not be negative — use zSignedCents for refunds/adjustments")
  .transform((n) => n as Cents);

/** Integer cents that may be negative (refunds, ledger adjustments, discounts). */
export const zSignedCents = z
  .number()
  .int("cents must be an integer — never a fractional-cent amount")
  .transform((n) => n as Cents);

export function centsFromDollars(dollars: number): Cents {
  if (!Number.isFinite(dollars)) {
    throw new RangeError(`centsFromDollars: not a finite number: ${dollars}`);
  }
  // Round at the cent boundary to avoid float drift (e.g. 19.99 * 100 = 1998.9999...).
  return Math.round(dollars * 100) as Cents;
}

export function dollarsFromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/** `formatCentsUSD(1050)` -> `"$10.50"`. Display-only; never re-parse this string. */
export function formatCentsUSD(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const remainder = (abs % 100).toString().padStart(2, "0");
  return `${sign}$${dollars.toLocaleString("en-US")}.${remainder}`;
}

export function addCents(...values: readonly number[]): Cents {
  return values.reduce((sum, v) => sum + Math.trunc(v), 0) as Cents;
}

export const CURRENCY = "USD" as const;
export const zCurrency = z.literal(CURRENCY);
export type Currency = typeof CURRENCY;

// ---------------------------------------------------------------------------
// Phone numbers — E.164 (`+15551234567`), enforced at every boundary.
// ---------------------------------------------------------------------------

/** RFC 3966 / E.164: a leading `+`, no leading zero, 1-15 total digits. */
export const E164_PATTERN = /^\+[1-9]\d{1,14}$/;

export type E164Phone = string & { readonly __brand: "E164Phone" };

export const zE164 = z
  .string()
  .regex(E164_PATTERN, "must be E.164 format, e.g. +15551234567")
  .transform((s) => s as E164Phone);

/**
 * Best-effort normalization to E.164 for US/CA numbers (the only markets this
 * product serves at launch, SYSTEM_DESIGN §1/§6). This is deliberately NOT a
 * full libphonenumber port (zero runtime deps beyond zod, CLAUDE.md scope) —
 * it strips formatting punctuation and assumes NANP (+1) when no country code
 * is present. Returns `null` (never throws) when the input cannot be
 * confidently normalized, so callers can fall back to asking the caller to
 * repeat the number.
 */
export function normalizeToE164(raw: string, defaultCountryCode = "1"): E164Phone | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // Already E.164.
  if (E164_PATTERN.test(trimmed)) return trimmed as E164Phone;

  const digits = trimmed.replace(/[^0-9]/g, "");
  if (digits.length === 0) return null;

  let candidate: string;
  if (trimmed.startsWith("+")) {
    // Had a `+` but failed the strict pattern above (e.g. leading zero) — reject.
    return null;
  } else if (digits.length === 10) {
    // Bare NANP subscriber number: assume default country code.
    candidate = `+${defaultCountryCode}${digits}`;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    candidate = `+${digits}`;
  } else {
    candidate = `+${digits}`;
  }

  return E164_PATTERN.test(candidate) ? (candidate as E164Phone) : null;
}

// ---------------------------------------------------------------------------
// ISO-8601 timestamps (timestamptz on the wire).
// ---------------------------------------------------------------------------

/** `2026-09-07T14:03:00.000Z` or with a numeric offset — always tz-explicit. */
export const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

export type IsoTimestamp = string & { readonly __brand: "IsoTimestamp" };

export const zIsoTimestamp = z
  .string()
  .regex(ISO_TIMESTAMP_PATTERN, "must be an ISO-8601 timestamp with an explicit timezone/offset")
  .transform((s) => s as IsoTimestamp);
