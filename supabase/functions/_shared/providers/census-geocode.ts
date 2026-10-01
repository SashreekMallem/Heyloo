/**
 * US Census Geocoder, one-line address forward geocoding (DELIVERY-1).
 * Free and keyless; US addresses only.
 *
 * `GET https://geocoding.geo.census.gov/geocoder/locations/onelineaddress
 *    ?address=<one line>&benchmark=Public_AR_Current&format=json`
 *
 * Shape confirmed against the official API doc
 * (https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.pdf,
 * fetched 2026-10-01) and a live call the same day:
 * `{ result: { input: {...}, addressMatches: [ { matchedAddress,
 * coordinates: { x: <lng>, y: <lat> }, addressComponents: { fromAddress,
 * toAddress, preQualifier, preDirection, preType, streetName, suffixType,
 * suffixDirection, suffixQualifier, city, state, zip }, tigerLine } ] } }`.
 * No match is `addressMatches: []` with HTTP 200. An empty or over-100-
 * character address is HTTP 400 `{ errors: [...], status: "400" }` (seen
 * live; not in the PDF), so the input is capped before sending.
 *
 * `fromAddress`/`toAddress` are the TIGER address RANGE of the matched
 * street segment, not the caller's house number, so the street line is
 * taken from `matchedAddress` (everything before its first comma) rather
 * than rebuilt from components.
 *
 * Never throws: a timeout, a non-2xx answer or an unexpected body is a
 * normal outcome the caller turns into "could not verify", validated with
 * Zod at this boundary (docs/VERIFY.md DELIVERY-1).
 */

import { z } from "zod";

export const CENSUS_GEOCODER_URL =
  "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
export const CENSUS_BENCHMARK = "Public_AR_Current";
/** The geocoder rejects (HTTP 400) an address longer than this. */
export const CENSUS_MAX_ADDRESS_CHARS = 100;
export const DEFAULT_CENSUS_TIMEOUT_MS = 1_500;

export type CensusFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface CensusMatch {
  matchedAddress: string;
  lat: number;
  lng: number;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export type CensusGeocodeResult =
  | { ok: true; match: CensusMatch }
  | { ok: true; match: null }
  | { ok: false; reason: "timeout" | "http_error" | "bad_response" };

const optionalText = z
  .string()
  .optional()
  .transform((v) => {
    const t = v?.trim();
    return t ? t : undefined;
  });

const CensusAddressMatchSchema = z.object({
  matchedAddress: z.string().min(1),
  coordinates: z.object({
    x: z.number().min(-180).max(180),
    y: z.number().min(-90).max(90),
  }),
  addressComponents: z
    .object({ city: optionalText, state: optionalText, zip: optionalText })
    .partial()
    .optional(),
});

const CensusResponseSchema = z.object({
  result: z.object({ addressMatches: z.array(z.unknown()) }),
});

/** Builds the one-line input the geocoder takes ("street, city, state zip"). */
export function oneLineAddress(parts: {
  street: string;
  city?: string | null | undefined;
  state?: string | null | undefined;
  zip?: string | null | undefined;
}): string {
  const clean = (v: string | null | undefined) => v?.replace(/\s+/g, " ").trim() ?? "";
  const stateZip = [clean(parts.state), clean(parts.zip)].filter(Boolean).join(" ");
  return [clean(parts.street), clean(parts.city), stateZip].filter(Boolean).join(", ");
}

/** Forward-geocodes one address; the best (first) match only. */
export async function geocodeOneLine(
  fetchImpl: CensusFetch,
  address: string,
  options: { timeoutMs?: number } = {},
): Promise<CensusGeocodeResult> {
  const query = address.replace(/\s+/g, " ").trim().slice(0, CENSUS_MAX_ADDRESS_CHARS);
  if (!query) return { ok: true, match: null };
  const url =
    `${CENSUS_GEOCODER_URL}?address=${encodeURIComponent(query)}` +
    `&benchmark=${CENSUS_BENCHMARK}&format=json`;

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_CENSUS_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, reason: "http_error" };
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ok: false, reason: timedOut ? "timeout" : "bad_response" };
    }
    const parsed = CensusResponseSchema.safeParse(body);
    if (!parsed.success) return { ok: false, reason: "bad_response" };
    const first = parsed.data.result.addressMatches[0];
    if (first === undefined) return { ok: true, match: null };
    const match = CensusAddressMatchSchema.safeParse(first);
    if (!match.success) return { ok: false, reason: "bad_response" };
    const m = match.data;
    const street = m.matchedAddress.split(",")[0]?.trim();
    const components = m.addressComponents ?? {};
    return {
      ok: true,
      match: {
        matchedAddress: m.matchedAddress,
        lat: m.coordinates.y,
        lng: m.coordinates.x,
        ...(street ? { street } : {}),
        ...(components.city ? { city: components.city } : {}),
        ...(components.state ? { state: components.state } : {}),
        ...(components.zip ? { zip: components.zip } : {}),
      },
    };
  } catch {
    return { ok: false, reason: timedOut ? "timeout" : "http_error" };
  } finally {
    clearTimeout(timer);
  }
}
