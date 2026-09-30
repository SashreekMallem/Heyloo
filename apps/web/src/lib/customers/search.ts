/**
 * Customer-search term handling for the tenant portal (QA-1 F-10 / SEC-15).
 *
 * The page used to interpolate the raw term into a PostgREST
 * `.or("name.ilike.%TERM%,phone_e164.ilike.%TERM%")` filter. A comma or
 * parenthesis in the term broke the filter grammar (HTTP 400, silently shown
 * as "No customers yet"), `x%,name.neq.zzz` injected an extra OR branch, `%`
 * matched everything, and a phone typed the way it is displayed
 * ("(555) 201-9010") never matched the stored E.164 ("+15552019010").
 *
 * The search now issues two plain `.ilike()` filters (the value is the whole
 * query-string parameter, so no filter-grammar characters are special) with
 * the LIKE wildcards escaped, and matches phones on digits only.
 */

/** Escapes LIKE/ILIKE metacharacters so the term is matched literally. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, "\\$&");
}

export interface CustomerSearchFilters {
  /** ILIKE pattern for `customers.name`, or null when there is nothing to search. */
  namePattern: string | null;
  /** ILIKE pattern for `customers.phone_e164` (digits only), or null when the term has no digits. */
  phonePattern: string | null;
}

export function buildCustomerSearchFilters(raw: string): CustomerSearchFilters {
  const term = raw.trim();
  if (!term) return { namePattern: null, phonePattern: null };
  const digits = term.replace(/\D/g, "");
  return {
    namePattern: `%${escapeLike(term)}%`,
    phonePattern: digits ? `%${digits}%` : null,
  };
}
