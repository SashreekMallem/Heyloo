/**
 * Delivery-radius check for `create_order` (MASTER_SPEC §3.0): "Delivery
 * orders REQUIRE ... a delivery-radius check (geocode against tenant
 * address; out-of-radius → polite decline with pickup offer)". Pure
 * haversine distance — geocoding itself (turning an address string into
 * lat/lng) is an external-provider call (VERIFY.md: Geocodio vs Google,
 * MASTER_SPEC §3.0 flags this as a build-time pick) that happens once at
 * settings-save for the tenant and once per caller address at order time;
 * this module only does the pure-math radius comparison so it's unit
 * testable without a provider.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two points, in meters. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_METERS * c;
}

export function isWithinRadius(center: GeoPoint, point: GeoPoint, radiusMeters: number): boolean {
  return haversineMeters(center, point) <= radiusMeters;
}
