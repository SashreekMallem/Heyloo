/**
 * Small, dependency-free formatters for the live screen and its printed
 * ticket (LIVE-1). Times are always shown in the tenant's own timezone.
 */

const FALLBACK_TZ = "UTC";

function zoneOrUtc(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return FALLBACK_TZ;
  }
}

/** "6:05 PM" in the tenant's timezone. */
export function formatTimeInZone(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zoneOrUtc(timeZone),
    hour: "numeric",
    minute: "2-digit",
  }).format(typeof iso === "string" ? new Date(iso) : iso);
}

/** "Thu, Oct 9, 6:05 PM" in the tenant's timezone. */
export function formatDateTimeInZone(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zoneOrUtc(timeZone),
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(typeof iso === "string" ? new Date(iso) : iso);
}

/** "Just now", "4 min ago", "1 hr 5 min ago". */
export function formatAge(iso: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr ago` : `${hours} hr ${rest} min ago`;
}

/**
 * Short order number for the screen and the ticket: the last 6 characters of
 * the id, e.g. "#C03F9A". A display aid, not a key. Six hex characters keep
 * a same-day clash unlikely (about 0.007% a day at 50 orders; four gave ~2%).
 */
export function shortOrderNumber(id: string): string {
  const compact = id.replace(/[^0-9a-z]/gi, "");
  return `#${compact.slice(-6).toUpperCase()}`;
}

const FULFILLMENT_LABEL: Record<string, string> = {
  pickup: "Pickup",
  delivery: "Delivery",
  dine_in: "Dine-in",
};

export function fulfillmentLabel(type: string): string {
  return FULFILLMENT_LABEL[type] ?? type;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * One line from `orders.delivery_address` jsonb. `create_order` writes
 * `street/city/state/zip`; older rows and the preview fixtures use `line1`.
 */
export function formatDeliveryAddress(address: Record<string, unknown> | null): string | null {
  if (!address) return null;
  const parts = [
    str(address["street"]) ?? str(address["line1"]),
    str(address["line2"]),
    str(address["city"]),
    [str(address["state"]), str(address["zip"])].filter(Boolean).join(" ") || null,
  ].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(", ") : null;
}
