/**
 * Display formatter for E.164 phone numbers (FRONTEND_SPEC.md §1.1) — the
 * single source of truth for "how a phone number looks to a human" so
 * every customer-facing surface (calls feed, customer list/detail, message
 * threads, Agent Settings → Transfer number) renders the same way instead
 * of some showing raw "+15125551000" and others a formatted "(512)
 * 555-1000" (round-5/6 tenant design review, medium).
 *
 * US/CA 10-digit numbers become "(XXX) XXX-XXXX"; anything else (a
 * non-NANP number, a malformed value, or a value that isn't 10 digits
 * after stripping the country code) is returned unchanged rather than
 * mangled, matching `PhoneInput`'s existing as-you-type formatting.
 */
export function formatPhoneDisplay(e164: string | null | undefined): string {
  if (!e164) return "";
  const digits = e164.replace(/^\+1?/, "");
  if (digits.length !== 10) return e164;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
