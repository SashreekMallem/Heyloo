import { z } from "zod";

/**
 * DELIVERY-1: the business's street address (`tenants.business_street/
 * city/state/zip`, migration 20261001130000) and, for restaurants, the
 * delivery area and charge (`tenants.delivery_radius_miles`,
 * `delivery_fee_base_cents`, `delivery_fee_per_mile_cents`,
 * `delivery_fee_included_miles`, `delivery_min_order_cents`). Same split as
 * `./business-contact.ts`: plain-string form fields (blank allowed) for the
 * client form, and server-boundary transforms that store only the
 * normalized shape the database CHECKs accept. Money is typed in dollars and
 * stored in integer cents, converted from the digits (never through a float).
 */

export const STATE_ERROR_MESSAGE = "Use the 2-letter state code, e.g. TX.";
export const ZIP_ERROR_MESSAGE = "Enter a 5-digit ZIP code, e.g. 75081.";
export const DOLLARS_ERROR_MESSAGE = "Enter a dollar amount like 4.50.";
export const NEGATIVE_ERROR_MESSAGE = "This can't be negative.";
export const DECIMALS_ERROR_MESSAGE = "Use at most 2 decimals.";
export const RADIUS_ERROR_MESSAGE = "Enter a radius between 0.1 and 100 miles.";
export const MILES_ERROR_MESSAGE = "Enter a number of miles, e.g. 2.";

/** Largest delivery fee part / minimum order an owner may enter, in dollars. */
export const MAX_FEE_DOLLARS = 500;
export const MAX_MIN_ORDER_DOLLARS = 10_000;
export const MAX_RADIUS_MILES = 100;

/** "tx" / " TX " -> "TX"; null when blank or not two letters. */
export function normalizeState(raw: string | null | undefined): string | null {
  const t = raw?.trim() ?? "";
  return /^[A-Za-z]{2}$/.test(t) ? t.toUpperCase() : null;
}

/** "75081" / "75081-1234" / "750811234" -> "75081" / "75081-1234"; null otherwise. */
export function normalizeZip(raw: string | null | undefined): string | null {
  const t = raw?.trim() ?? "";
  const m = /^(\d{5})(?:-?(\d{4}))?$/.exec(t);
  if (!m) return null;
  return m[2] ? `${m[1]}-${m[2]}` : (m[1] ?? null);
}

export type AmountParse =
  | { ok: true; hundredths: number }
  | { ok: false; reason: "format" | "negative" | "decimals" };

/**
 * "4.5" / "$4.50" / "12" -> hundredths (450 / 450 / 1200), from the digits so
 * no binary rounding is involved. Rejects negatives and more than 2 decimals.
 */
export function parseHundredths(raw: string | number): AmountParse {
  const t = (typeof raw === "number" ? String(raw) : raw).trim().replace(/^\$/, "").trim();
  if (/^-/.test(t)) return { ok: false, reason: "negative" };
  if (/^\d*\.\d{3,}$/.test(t)) return { ok: false, reason: "decimals" };
  const m = /^(\d{1,7})(?:\.(\d{0,2}))?$|^\.(\d{1,2})$/.exec(t);
  if (!m) return { ok: false, reason: "format" };
  const whole = Number(m[1] ?? "0");
  const frac = (m[2] ?? m[3] ?? "").padEnd(2, "0");
  return { ok: true, hundredths: whole * 100 + Number(frac || "0") };
}

function amountMessage(reason: "format" | "negative" | "decimals", format: string): string {
  if (reason === "negative") return NEGATIVE_ERROR_MESSAGE;
  if (reason === "decimals") return DECIMALS_ERROR_MESSAGE;
  return format;
}

/** Cents -> "4.50" for an input's default value; "" when unset. */
export function centsToDollarsInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2);
}

/** Stored miles (number or numeric string) -> input text, "" when unset. */
export function milesToInput(miles: number | string | null | undefined): string {
  if (miles === null || miles === undefined || miles === "") return "";
  const n = Number(miles);
  return Number.isFinite(n) ? String(n) : "";
}

// ---------------------------------------------------------------------------
// Client form fields (strings; blank allowed)
// ---------------------------------------------------------------------------

export const zStreetFormField = z.string().trim().max(200, "Keep the street under 200 characters.");
export const zCityFormField = z.string().trim().max(100, "Keep the city under 100 characters.");
export const zStateFormField = z
  .string()
  .trim()
  .refine((v) => v.length === 0 || normalizeState(v) !== null, STATE_ERROR_MESSAGE);
export const zZipFormField = z
  .string()
  .trim()
  .refine((v) => v.length === 0 || normalizeZip(v) !== null, ZIP_ERROR_MESSAGE);

function zAmountFormField(maxHundredths: number, format: string, tooBig: string) {
  return z
    .string()
    .trim()
    .superRefine((v, ctx) => {
      if (v.length === 0) return;
      const parsed = parseHundredths(v);
      if (!parsed.ok) {
        ctx.addIssue({ code: "custom", message: amountMessage(parsed.reason, format) });
      } else if (parsed.hundredths > maxHundredths) {
        ctx.addIssue({ code: "custom", message: tooBig });
      }
    });
}

export const zDollarsFormField = zAmountFormField(
  MAX_FEE_DOLLARS * 100,
  DOLLARS_ERROR_MESSAGE,
  `Keep this under $${MAX_FEE_DOLLARS}.`,
);
export const zMinOrderFormField = zAmountFormField(
  MAX_MIN_ORDER_DOLLARS * 100,
  DOLLARS_ERROR_MESSAGE,
  `Keep this under $${MAX_MIN_ORDER_DOLLARS}.`,
);
export const zIncludedMilesFormField = zAmountFormField(
  MAX_RADIUS_MILES * 100,
  MILES_ERROR_MESSAGE,
  `Keep this under ${MAX_RADIUS_MILES} miles.`,
);
export const zRadiusFormField = z
  .string()
  .trim()
  .superRefine((v, ctx) => {
    if (v.length === 0) return;
    const parsed = parseHundredths(v);
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: amountMessage(parsed.reason, RADIUS_ERROR_MESSAGE) });
    } else if (parsed.hundredths < 10 || parsed.hundredths > MAX_RADIUS_MILES * 100) {
      ctx.addIssue({ code: "custom", message: RADIUS_ERROR_MESSAGE });
    }
  });

// ---------------------------------------------------------------------------
// Server request fields: missing key -> undefined (leave alone), blank or
// null -> null (clear), otherwise the normalized value or a 422 issue.
// ---------------------------------------------------------------------------

function zOptionalTextField(max: number, message: string) {
  return z
    .string()
    .max(max, message)
    .nullish()
    .transform((v) => {
      if (v === undefined) return undefined;
      const t = v?.replace(/\s+/g, " ").trim() ?? "";
      return t.length > 0 ? t : null;
    });
}

function zOptionalNormalized(normalize: (v: string) => string | null, message: string) {
  return z
    .string()
    .max(20)
    .nullish()
    .transform((v, ctx) => {
      if (v === undefined) return undefined;
      if (v === null || v.trim().length === 0) return null;
      const n = normalize(v);
      if (n === null) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return n;
    });
}

export const zOptionalStreet = zOptionalTextField(200, "Keep the street under 200 characters.");
export const zOptionalCity = zOptionalTextField(100, "Keep the city under 100 characters.");
export const zOptionalState = zOptionalNormalized(normalizeState, STATE_ERROR_MESSAGE);
export const zOptionalZip = zOptionalNormalized(normalizeZip, ZIP_ERROR_MESSAGE);

/**
 * An amount typed in dollars (or miles) -> integer hundredths (cents), or a
 * 422 issue. `min`/`max` are in hundredths, inclusive.
 */
function zOptionalHundredths(opts: { min: number; max: number; format: string; range: string }) {
  return z
    .union([z.string().max(20), z.number()])
    .nullish()
    .transform((v, ctx) => {
      if (v === undefined) return undefined;
      if (v === null || (typeof v === "string" && v.trim().length === 0)) return null;
      const parsed = parseHundredths(v);
      if (!parsed.ok) {
        ctx.addIssue({ code: "custom", message: amountMessage(parsed.reason, opts.format) });
        return z.NEVER;
      }
      if (parsed.hundredths < opts.min || parsed.hundredths > opts.max) {
        ctx.addIssue({ code: "custom", message: opts.range });
        return z.NEVER;
      }
      return parsed.hundredths;
    });
}

/** Dollars -> cents. */
export const zOptionalFeeCents = zOptionalHundredths({
  min: 0,
  max: MAX_FEE_DOLLARS * 100,
  format: DOLLARS_ERROR_MESSAGE,
  range: `Keep this under $${MAX_FEE_DOLLARS}.`,
});
export const zOptionalMinOrderCents = zOptionalHundredths({
  min: 0,
  max: MAX_MIN_ORDER_DOLLARS * 100,
  format: DOLLARS_ERROR_MESSAGE,
  range: `Keep this under $${MAX_MIN_ORDER_DOLLARS}.`,
});
/** Miles, to the hundredth: radius 0.1-100. Returned in hundredths; divide by 100 to store. */
export const zOptionalRadiusHundredths = zOptionalHundredths({
  min: 10,
  max: MAX_RADIUS_MILES * 100,
  format: RADIUS_ERROR_MESSAGE,
  range: RADIUS_ERROR_MESSAGE,
});
export const zOptionalIncludedMilesHundredths = zOptionalHundredths({
  min: 0,
  max: MAX_RADIUS_MILES * 100,
  format: MILES_ERROR_MESSAGE,
  range: `Keep this under ${MAX_RADIUS_MILES} miles.`,
});

/** Enough of an address to geocode: a street plus a ZIP, or a city and state (mirrors `_shared/delivery-distance.ts#businessAddressKey`). */
export function isAddressComplete(a: {
  street: string | null | undefined;
  city: string | null | undefined;
  state: string | null | undefined;
  zip: string | null | undefined;
}): boolean {
  const has = (v: string | null | undefined) => (v ?? "").trim().length > 0;
  return has(a.street) && (has(a.zip) || (has(a.city) && has(a.state)));
}
