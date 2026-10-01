/**
 * DELIVERY-1: is a caller's delivery address real, and is it within the
 * restaurant's delivery radius? Shared by the `check_delivery_address` voice
 * tool, `create_order` (inline check when the agent skipped the tool) and
 * the portal's "locate my business" edge function.
 *
 * Locations come from the US Census Geocoder (`providers/census-geocode.ts`,
 * keyless). The business's own location is geocoded lazily and cached on
 * `tenants.business_lat/lng` together with the normalized address it was
 * computed from (`business_location_key`), so an owner's address edit is
 * detected and re-geocoded on next use. Distance is straight-line
 * (haversine), not driving distance.
 *
 * Everything here degrades instead of failing: a geocoder timeout is the
 * `lookup_unavailable` status, never an error the caller hears about.
 */

import { computeDeliveryFeeCents, type DeliveryFeePolicy } from "./delivery-fee.ts";
import { haversineMeters } from "./geo.ts";
import {
  type CensusFetch,
  DEFAULT_CENSUS_TIMEOUT_MS,
  geocodeOneLine,
  oneLineAddress,
} from "./providers/census-geocode.ts";
import type { Logger, SqlClient } from "./types.ts";

export const METERS_PER_MILE = 1_609.344;

/** A business whose address was not found is not re-geocoded on every call; retried after this. */
const NOT_FOUND_RETRY_MS = 24 * 60 * 60 * 1_000;

export const DELIVERY_CHECK_STATUSES = [
  "in_range",
  "out_of_range",
  "not_found",
  "no_business_location",
  "no_radius_set",
  "lookup_unavailable",
] as const;
export type DeliveryCheckStatus = (typeof DELIVERY_CHECK_STATUSES)[number];

export interface GeoLocation {
  lat: number;
  lng: number;
  matched: string | null;
}

export interface DeliveryDeps {
  fetchImpl: CensusFetch;
  /** Per geocoder request. Default 1500 ms. */
  timeoutMs?: number;
  logger: Logger;
  /** Injectable clock (tests). */
  now?: () => Date;
}

export interface DeliverySettings {
  tenantId: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  storedLocation: GeoLocation | null;
  locationKey: string | null;
  locatedAt: Date | null;
  /** Effective radius in miles (column, else the legacy `delivery_radius_m` override). */
  radiusMiles: number | null;
  fee: DeliveryFeePolicy;
  /** Effective delivery minimum (column, else the legacy `min_order_cents` override). */
  minOrderCents: number | null;
}

/** Straight-line distance in miles. */
export function haversineMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  return haversineMeters(a, b) / METERS_PER_MILE;
}

/** To the hundredth of a mile (what `delivery_address_checks.distance_miles` stores). */
export function roundMiles(miles: number): number {
  return Math.round(miles * 100) / 100;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function positive(value: unknown): number | null {
  const n = toNumber(value);
  return n !== null && n > 0 ? n : null;
}

function nonNegative(value: unknown): number | null {
  const n = toNumber(value);
  return n !== null && n >= 0 ? n : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * The string a business location is cached against: lower-cased, whitespace
 * collapsed, parts joined with `|`. Null when the address is not complete
 * enough to geocode (a street plus either a ZIP or a city and state).
 */
export function businessAddressKey(parts: {
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}): string | null {
  const norm = (v: string | null) => (v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const street = norm(parts.street);
  const city = norm(parts.city);
  const state = norm(parts.state);
  const zip = norm(parts.zip);
  if (!street || !(zip || (city && state))) return null;
  return [street, city, state, zip].join("|");
}

interface SettingsRow {
  business_street: string | null;
  business_city: string | null;
  business_state: string | null;
  business_zip: string | null;
  business_lat: number | null;
  business_lng: number | null;
  business_location_matched: string | null;
  business_location_key: string | null;
  business_located_at: string | Date | null;
  delivery_radius_miles: string | number | null;
  delivery_fee_base_cents: number | null;
  delivery_fee_per_mile_cents: number | null;
  delivery_fee_included_miles: string | number | null;
  delivery_min_order_cents: number | null;
  legacy_radius_m: unknown;
  legacy_fee_cents: unknown;
  legacy_min_order_cents: unknown;
}

/**
 * The tenant's business address, cached location and delivery policy, one
 * indexed read (tenants by id + its agent_configs row). The tenant columns
 * win; the older `agent_configs.dynamic_variable_overrides` keys
 * (`delivery_radius_m`, `delivery_fee_cents` as a flat fee, `min_order_cents`,
 * still editable on Agent -> Vertical details) are used only where the new
 * columns are unset, so a restaurant that configured those keeps its policy.
 */
export async function loadDeliverySettings(
  sql: SqlClient,
  tenantId: string,
): Promise<DeliverySettings | null> {
  const rows = await sql<SettingsRow>`
    select t.business_street, t.business_city, t.business_state, t.business_zip,
      t.business_lat, t.business_lng, t.business_location_matched, t.business_location_key,
      t.business_located_at, t.delivery_radius_miles, t.delivery_fee_base_cents,
      t.delivery_fee_per_mile_cents, t.delivery_fee_included_miles, t.delivery_min_order_cents,
      ac.dynamic_variable_overrides -> 'delivery_radius_m' as legacy_radius_m,
      ac.dynamic_variable_overrides -> 'delivery_fee_cents' as legacy_fee_cents,
      ac.dynamic_variable_overrides -> 'min_order_cents' as legacy_min_order_cents
    from public.tenants t
    left join public.agent_configs ac on ac.tenant_id = t.id
    where t.id = ${tenantId}
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;

  const lat = toNumber(row.business_lat);
  const lng = toNumber(row.business_lng);
  const legacyRadiusM = positive(row.legacy_radius_m);
  const feeColumnsSet =
    row.delivery_fee_base_cents !== null ||
    row.delivery_fee_per_mile_cents !== null ||
    row.delivery_fee_included_miles !== null;
  const locatedAt = row.business_located_at ? new Date(row.business_located_at) : null;

  return {
    tenantId,
    street: text(row.business_street),
    city: text(row.business_city),
    state: text(row.business_state),
    zip: text(row.business_zip),
    storedLocation:
      lat !== null && lng !== null ? { lat, lng, matched: row.business_location_matched } : null,
    locationKey: row.business_location_key,
    locatedAt: locatedAt && !Number.isNaN(locatedAt.getTime()) ? locatedAt : null,
    radiusMiles:
      positive(row.delivery_radius_miles) ??
      (legacyRadiusM !== null ? legacyRadiusM / METERS_PER_MILE : null),
    fee: feeColumnsSet
      ? {
          baseCents: nonNegative(row.delivery_fee_base_cents),
          perMileCents: nonNegative(row.delivery_fee_per_mile_cents),
          includedMiles: nonNegative(row.delivery_fee_included_miles),
        }
      : { baseCents: nonNegative(row.legacy_fee_cents), perMileCents: null, includedMiles: null },
    minOrderCents:
      nonNegative(row.delivery_min_order_cents) ?? positive(row.legacy_min_order_cents),
  };
}

export type BusinessLocationOutcome =
  | { ok: true; location: GeoLocation }
  | { ok: false; reason: "address_incomplete" | "not_found" | "lookup_unavailable" };

/**
 * The business's location for its CURRENT address: the cached one when it
 * was computed from this exact address, else a fresh geocode that is stored
 * (secret-key `sql`; best-effort, guarded so a concurrent owner edit is never
 * overwritten with the old address's location). A stale cached location is
 * never returned. `force` re-geocodes even a fresh cache (owner just saved).
 */
export async function resolveBusinessLocation(
  sql: SqlClient,
  settings: DeliverySettings,
  deps: DeliveryDeps & { force?: boolean },
): Promise<BusinessLocationOutcome> {
  const key = businessAddressKey(settings);
  if (!key) return { ok: false, reason: "address_incomplete" };
  const now = deps.now?.() ?? new Date();

  if (!deps.force && settings.locationKey === key) {
    if (settings.storedLocation) return { ok: true, location: settings.storedLocation };
    const recentlyMissed =
      settings.locatedAt !== null &&
      now.getTime() - settings.locatedAt.getTime() < NOT_FOUND_RETRY_MS;
    if (recentlyMissed) return { ok: false, reason: "not_found" };
  }

  const geocoded = await geocodeOneLine(
    deps.fetchImpl,
    oneLineAddress({
      street: settings.street ?? "",
      city: settings.city,
      state: settings.state,
      zip: settings.zip,
    }),
    { timeoutMs: deps.timeoutMs ?? DEFAULT_CENSUS_TIMEOUT_MS },
  );
  if (!geocoded.ok) {
    deps.logger.warn("business_location_lookup_unavailable", {
      tenant_id: settings.tenantId,
      reason: geocoded.reason,
    });
    return { ok: false, reason: "lookup_unavailable" };
  }

  const match = geocoded.match;
  try {
    await sql`
      update public.tenants
      set business_lat = ${match?.lat ?? null},
          business_lng = ${match?.lng ?? null},
          business_location_matched = ${match?.matchedAddress ?? null},
          business_location_key = ${key},
          business_located_at = ${now.toISOString()}
      where id = ${settings.tenantId}
        and business_street is not distinct from ${settings.street}
        and business_city is not distinct from ${settings.city}
        and business_state is not distinct from ${settings.state}
        and business_zip is not distinct from ${settings.zip}
    `;
  } catch (err) {
    deps.logger.warn("business_location_store_failed", {
      tenant_id: settings.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (!match) return { ok: false, reason: "not_found" };
  return { ok: true, location: { lat: match.lat, lng: match.lng, matched: match.matchedAddress } };
}

/** Loads the tenant and returns its business location, or null when it has none (yet). */
export async function ensureBusinessLocation(
  sql: SqlClient,
  tenantId: string,
  deps: DeliveryDeps,
): Promise<GeoLocation | null> {
  const settings = await loadDeliverySettings(sql, tenantId);
  if (!settings) return null;
  const outcome = await resolveBusinessLocation(sql, settings, deps);
  return outcome.ok ? outcome.location : null;
}

export interface DeliveryAddressInput {
  street: string;
  city?: string | undefined;
  state?: string | undefined;
  zip?: string | undefined;
}

export interface DeliveryCheck {
  status: DeliveryCheckStatus;
  matchedAddress: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  /** Straight-line miles from the business, when both locations are known. */
  distanceMiles: number | null;
  radiusMiles: number | null;
  /** The delivery fee for this distance (base fee only when the distance is unknown). */
  deliveryFeeCents: number;
  minOrderCents: number | null;
  /** `delivery_address_checks.id`, when the row was written. */
  checkId: string | null;
}

/**
 * Locates the caller's address and the business (in parallel), classifies
 * it, and records a `delivery_address_checks` row (best-effort: a failed
 * insert never fails the check). Rules: geocoder down -> lookup_unavailable;
 * no match -> not_found; business not locatable -> no_business_location; no
 * radius configured -> no_radius_set (matched address and distance still
 * returned); otherwise in_range / out_of_range against the radius.
 */
export async function checkDeliveryAddress(
  sql: SqlClient,
  ctx: { tenantId: string; providerCallId: string | null },
  input: DeliveryAddressInput,
  deps: DeliveryDeps & { settings?: DeliverySettings | null },
): Promise<DeliveryCheck> {
  const inputAddress = oneLineAddress(input);
  let settings: DeliverySettings | null = null;
  try {
    settings =
      deps.settings !== undefined ? deps.settings : await loadDeliverySettings(sql, ctx.tenantId);
  } catch (err) {
    deps.logger.warn("delivery_settings_read_failed", {
      tenant_id: ctx.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const timeoutMs = deps.timeoutMs ?? DEFAULT_CENSUS_TIMEOUT_MS;
  const [caller, business] = await Promise.all([
    geocodeOneLine(deps.fetchImpl, inputAddress, { timeoutMs }),
    settings
      ? resolveBusinessLocation(sql, settings, deps)
      : Promise.resolve<BusinessLocationOutcome>({ ok: false, reason: "address_incomplete" }),
  ]);

  const radiusMiles = settings?.radiusMiles ?? null;
  const fee = settings?.fee ?? { baseCents: null, perMileCents: null, includedMiles: null };
  const base = {
    matchedAddress: null,
    street: null,
    city: null,
    state: null,
    zip: null,
    lat: null,
    lng: null,
    distanceMiles: null,
    radiusMiles,
    minOrderCents: settings?.minOrderCents ?? null,
  };

  let check: Omit<DeliveryCheck, "checkId">;
  if (!caller.ok) {
    deps.logger.warn("delivery_address_lookup_unavailable", {
      tenant_id: ctx.tenantId,
      reason: caller.reason,
    });
    check = {
      ...base,
      status: "lookup_unavailable",
      deliveryFeeCents: computeDeliveryFeeCents(fee, null),
    };
  } else if (!caller.match) {
    check = { ...base, status: "not_found", deliveryFeeCents: computeDeliveryFeeCents(fee, null) };
  } else {
    const m = caller.match;
    const located = {
      ...base,
      matchedAddress: m.matchedAddress,
      street: m.street ?? null,
      city: m.city ?? null,
      state: m.state ?? null,
      zip: m.zip ?? null,
      lat: m.lat,
      lng: m.lng,
    };
    if (!business.ok) {
      check = {
        ...located,
        status: "no_business_location",
        deliveryFeeCents: computeDeliveryFeeCents(fee, null),
      };
    } else {
      const distanceMiles = roundMiles(haversineMiles(business.location, m));
      const status: DeliveryCheckStatus =
        radiusMiles === null
          ? "no_radius_set"
          : distanceMiles <= radiusMiles
            ? "in_range"
            : "out_of_range";
      check = {
        ...located,
        status,
        distanceMiles,
        deliveryFeeCents: computeDeliveryFeeCents(fee, distanceMiles),
      };
    }
  }

  let checkId: string | null = null;
  try {
    const inserted = await sql<{ id: string }>`
      insert into public.delivery_address_checks (
        tenant_id, provider_call_id, input_address, status, matched_address,
        street, city, state, zip, lat, lng, distance_miles
      ) values (
        ${ctx.tenantId}, ${ctx.providerCallId}, ${inputAddress || input.street}, ${check.status},
        ${check.matchedAddress}, ${check.street}, ${check.city}, ${check.state}, ${check.zip},
        ${check.lat}, ${check.lng}, ${check.distanceMiles}
      )
      returning id
    `;
    checkId = inserted[0]?.id ?? null;
  } catch (err) {
    deps.logger.warn("delivery_address_check_insert_failed", {
      tenant_id: ctx.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return { ...check, checkId };
}

/** Case/space/punctuation-insensitive form of a street line, for matching. */
export function normalizeStreet(street: string): string {
  return street.toLowerCase().replace(/[.,#]/g, " ").replace(/\s+/g, " ").trim();
}

export interface StoredDeliveryCheck {
  status: DeliveryCheckStatus;
  inputAddress: string;
  matchedAddress: string | null;
  street: string | null;
  lat: number | null;
  lng: number | null;
  distanceMiles: number | null;
}

/** How far back `create_order` looks for a check of the same call. */
const RECENT_CHECK_WINDOW = "2 hours";

/**
 * The latest `delivery_address_checks` row of this call whose street matches
 * `street` — either the street the agent checked or the Census street line it
 * read back (optionally followed by a unit). `lookup_unavailable` rows are
 * skipped (worth retrying).
 */
export async function findRecentDeliveryCheck(
  sql: SqlClient,
  tenantId: string,
  providerCallId: string,
  street: string,
): Promise<StoredDeliveryCheck | null> {
  const wanted = normalizeStreet(street.split(",")[0] ?? street);
  if (!wanted) return null;
  const rows = await sql<{
    status: DeliveryCheckStatus;
    input_address: string;
    matched_address: string | null;
    street: string | null;
    lat: number | null;
    lng: number | null;
    distance_miles: string | number | null;
  }>`
    select status, input_address, matched_address, street, lat, lng, distance_miles
    from public.delivery_address_checks
    where tenant_id = ${tenantId} and provider_call_id = ${providerCallId}
      and status <> 'lookup_unavailable'
      and created_at > now() - ${RECENT_CHECK_WINDOW}::interval
    order by created_at desc
    limit 10
  `;
  for (const row of rows) {
    const checkedStreet = normalizeStreet(row.input_address.split(",")[0] ?? "");
    const matchedStreet = row.street ? normalizeStreet(row.street) : "";
    // A unit appended to the street on create_order ("12 Elm St Apt 4") still
    // matches the street that was checked ("12 Elm St").
    const sameStreet = (s: string) => s !== "" && (wanted === s || wanted.startsWith(`${s} `));
    if (sameStreet(checkedStreet) || sameStreet(matchedStreet)) {
      return {
        status: row.status,
        inputAddress: row.input_address,
        matchedAddress: row.matched_address,
        street: row.street,
        lat: toNumber(row.lat),
        lng: toNumber(row.lng),
        distanceMiles: toNumber(row.distance_miles),
      };
    }
  }
  return null;
}
