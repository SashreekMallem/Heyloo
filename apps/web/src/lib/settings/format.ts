/**
 * Same display rule as `@heyloo/ui`'s `formatPhoneDisplay` ("(610) 555-0122"
 * for a +1 number, anything else unchanged) — duplicated here so server
 * route handlers that build owner-facing text never pull the client UI
 * barrel into their bundle.
 */
export function formatPhoneDisplay(e164: string | null | undefined): string {
  if (!e164) return "";
  const digits = e164.replace(/^\+1?/, "");
  if (!e164.startsWith("+1") || digits.length !== 10) return e164;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** "$89.00" from integer cents. */
export function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Parses an owner-typed dollar amount ("89", "$89.50", "1,200") into
 * integer cents; `null` for anything that isn't a non-negative amount with
 * at most two decimals.
 */
export function parseDollarsToCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  const parts = cleaned.split(".");
  if (parts.length > 2) return null;
  const [whole = "", fraction = ""] = parts;
  if (!/^\d+$/.test(whole)) return null;
  if (parts.length === 2 && !/^\d{1,2}$/.test(fraction)) return null;
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
