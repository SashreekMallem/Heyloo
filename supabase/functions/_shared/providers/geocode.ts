/**
 * Geocod.io forward geocoding (MASTER_SPEC §3.0 `VERIFY:` "Geocodio vs
 * Google" — Geocodio picked here; docs/VERIFY.md records the doc-fetch this
 * was confirmed against). Turns a caller's spoken delivery address into a
 * lat/lng so it can be saved onto `customer_addresses.geocode` (a native
 * Postgres `point`) — the input `create_order`'s delivery-radius check
 * needs (GAP_REGISTER.md §1.8 / restaurant.md Finding B4: the check is
 * reachable code that can never fire without a saved caller geocode).
 * Plain `fetch`, mirroring this directory's other providers (apollo.ts,
 * google-calendar.ts) — no SDK dependency.
 */

const GEOCODIO_BASE_URL = "https://api.geocod.io/v2/geocode";

export type GeocodeFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface GeocodeAddressInput {
  street: string;
  city?: string | undefined;
  state?: string | undefined;
  zip?: string | undefined;
}

export interface GeocodePoint {
  lat: number;
  lng: number;
}

export interface GeocodeResult {
  ok: boolean;
  status: number;
  point?: GeocodePoint;
}

/**
 * `GET /v2/geocode?api_key=...&q=...` — single best match (`limit=1`).
 * Response shape: `{ results: [{ location: { lat, lng }, ... }, ...] }`.
 * Never throws on a bad/unmatched address or a non-2xx response — a failed
 * geocode is a normal, expected outcome (unrecognized address, provider
 * outage) that callers treat as "no geocode available yet", not an error.
 */
export async function geocodeAddress(
  fetchImpl: GeocodeFetch,
  apiKey: string,
  address: GeocodeAddressInput,
): Promise<GeocodeResult> {
  const q = [address.street, address.city, address.state, address.zip]
    .filter((part): part is string => !!part && part.trim().length > 0)
    .join(", ");
  if (!q) return { ok: false, status: 0 };

  const url = `${GEOCODIO_BASE_URL}?api_key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(q)}&limit=1`;
  const res = await fetchImpl(url, { method: "GET" });
  if (!res.ok) return { ok: false, status: res.status };

  const body = (await res.json().catch(() => undefined)) as
    | { results?: { location?: { lat?: number; lng?: number } }[] }
    | undefined;
  const location = body?.results?.[0]?.location;
  if (typeof location?.lat !== "number" || typeof location?.lng !== "number") {
    return { ok: false, status: res.status };
  }
  return { ok: true, status: res.status, point: { lat: location.lat, lng: location.lng } };
}
