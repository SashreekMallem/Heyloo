/**
 * New-arrival detection for the live screen (LIVE-1). Realtime broadcasts
 * are not replayed after a reconnect and the screen also polls every 15 s,
 * so "new" is decided by diffing ids against everything seen since the
 * screen loaded, never from a broadcast payload. The first load only
 * records a baseline: it never reports anything as new (so opening the
 * screen never chimes for old items).
 */
export interface SeenIds {
  /** False until the first successful load has been recorded. */
  primed: boolean;
  ids: ReadonlySet<string>;
}

export const EMPTY_SEEN: SeenIds = { primed: false, ids: new Set() };

export function diffNewIds(
  seen: SeenIds,
  currentIds: readonly string[],
): { seen: SeenIds; fresh: string[] } {
  if (!seen.primed) {
    return { seen: { primed: true, ids: new Set(currentIds) }, fresh: [] };
  }
  const fresh = currentIds.filter((id) => !seen.ids.has(id));
  if (fresh.length === 0) return { seen, fresh };
  // Union, not replace: an item that briefly drops out of a window (or a
  // page of results) and comes back must not count as new a second time.
  return { seen: { primed: true, ids: new Set([...seen.ids, ...fresh]) }, fresh };
}

/** Per-device acknowledgements ("Got it"), keyed as in device-store. */
export type Acks = Readonly<Record<string, number>>;

export const ackKey = {
  booking: (id: string) => `booking:${id}`,
  message: (id: string) => `message:${id}`,
};

/** Whether a row was created inside the `windowMs` that ends at `nowMs`. */
export function createdWithin(createdAtIso: string, nowMs: number, windowMs: number): boolean {
  const at = new Date(createdAtIso).getTime();
  return Number.isFinite(at) && at >= nowMs - windowMs;
}

/**
 * A booking shows "New" (with a "Got it" button) while it was created in
 * the live window and nobody on this device has acknowledged it. The same
 * rule decides what counts as a booking ARRIVAL: a booking that only joins
 * the list because the "today" window moved at midnight, or because an old
 * booking was rescheduled into today, was not just made, so it must not
 * ring (it would have no "Got it" to stop it).
 */
export function isBookingNew(
  booking: { id: string; createdAt: string },
  acks: Acks,
  nowMs: number,
  windowMs: number,
): boolean {
  return !acks[ackKey.booking(booking.id)] && createdWithin(booking.createdAt, nowMs, windowMs);
}

/** Messages are already limited to the live window, so only the ack matters. */
export function isMessageNew(message: { id: string }, acks: Acks): boolean {
  return !acks[ackKey.message(message.id)];
}

/**
 * What keeps the chime ringing:
 * - every order still in "received", including ones already waiting when
 *   the screen loaded, so a reload never silences an unconfirmed order;
 * - every booking / message that ARRIVED since the screen opened and still
 *   shows "New" (the badge's own rule, so each one has a "Got it").
 */
export function pendingAlerts(input: {
  orders: readonly { status: string }[];
  bookings: readonly { id: string; createdAt: string }[];
  messages: readonly { id: string }[];
  arrivedBookings: ReadonlySet<string>;
  arrivedMessages: ReadonlySet<string>;
  acks: Acks;
  nowMs: number;
  windowMs: number;
}): { waitingOrders: number; unacknowledgedArrivals: number } {
  const { acks, nowMs, windowMs } = input;
  const bookings = input.bookings.filter(
    (b) => input.arrivedBookings.has(b.id) && isBookingNew(b, acks, nowMs, windowMs),
  ).length;
  const messages = input.messages.filter(
    (m) => input.arrivedMessages.has(m.id) && isMessageNew(m, acks),
  ).length;
  return {
    waitingOrders: input.orders.filter((o) => o.status === "received").length,
    unacknowledgedArrivals: bookings + messages,
  };
}
