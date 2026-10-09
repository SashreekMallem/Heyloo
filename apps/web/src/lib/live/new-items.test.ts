import { describe, expect, it } from "vitest";
import {
  ackKey,
  createdWithin,
  diffNewIds,
  EMPTY_SEEN,
  isBookingNew,
  isMessageNew,
  pendingAlerts,
} from "./new-items";

describe("diffNewIds (LIVE-1)", () => {
  it("treats the first load as a silent baseline", () => {
    const { seen, fresh } = diffNewIds(EMPTY_SEEN, ["a", "b"]);
    expect(fresh).toEqual([]);
    expect(seen.primed).toBe(true);
    expect([...seen.ids].sort()).toEqual(["a", "b"]);
  });

  it("an empty first load still primes, so the next item counts as new", () => {
    const first = diffNewIds(EMPTY_SEEN, []);
    expect(first.fresh).toEqual([]);
    expect(diffNewIds(first.seen, ["x"]).fresh).toEqual(["x"]);
  });

  it("reports only ids never seen before", () => {
    const first = diffNewIds(EMPTY_SEEN, ["a", "b"]);
    const second = diffNewIds(first.seen, ["b", "c", "a", "d"]);
    expect(second.fresh).toEqual(["c", "d"]);
  });

  it("a repeated refetch with the same ids reports nothing and keeps the same state", () => {
    const first = diffNewIds(EMPTY_SEEN, ["a"]);
    const second = diffNewIds(first.seen, ["a"]);
    expect(second.fresh).toEqual([]);
    expect(second.seen).toBe(first.seen);
  });

  it("an item that leaves the list and comes back is not new again", () => {
    const first = diffNewIds(EMPTY_SEEN, ["a"]);
    const gone = diffNewIds(first.seen, []);
    const back = diffNewIds(gone.seen, ["a"]);
    expect(back.fresh).toEqual([]);
  });

  it("does not mutate the previous state", () => {
    const first = diffNewIds(EMPTY_SEEN, ["a"]);
    diffNewIds(first.seen, ["a", "b"]);
    expect([...first.seen.ids]).toEqual(["a"]);
    expect(EMPTY_SEEN.ids.size).toBe(0);
  });
});

const DAY = 24 * 3_600_000;
const NOW = Date.parse("2026-10-10T05:30:00Z"); // 00:30 in Chicago: just past tenant midnight

describe("createdWithin / isBookingNew / isMessageNew (LIVE-1)", () => {
  it("counts a row as recent only inside the window", () => {
    expect(createdWithin(new Date(NOW - DAY + 1).toISOString(), NOW, DAY)).toBe(true);
    expect(createdWithin(new Date(NOW - DAY - 1).toISOString(), NOW, DAY)).toBe(false);
    expect(createdWithin("not a date", NOW, DAY)).toBe(false);
  });

  it("a booking is new until acknowledged, and only while it was made in the window", () => {
    const fresh = { id: "b1", createdAt: new Date(NOW - 60_000).toISOString() };
    const old = { id: "b2", createdAt: new Date(NOW - 3 * DAY).toISOString() };
    expect(isBookingNew(fresh, {}, NOW, DAY)).toBe(true);
    expect(isBookingNew(fresh, { [ackKey.booking("b1")]: NOW }, NOW, DAY)).toBe(false);
    expect(isBookingNew(old, {}, NOW, DAY)).toBe(false);
  });

  it("a message is new until acknowledged", () => {
    expect(isMessageNew({ id: "m1" }, {})).toBe(true);
    expect(isMessageNew({ id: "m1" }, { [ackKey.message("m1")]: NOW })).toBe(false);
  });
});

describe("pendingAlerts (LIVE-1)", () => {
  const base = {
    orders: [],
    bookings: [],
    messages: [],
    arrivedBookings: new Set<string>(),
    arrivedMessages: new Set<string>(),
    acks: {},
    nowMs: NOW,
    windowMs: DAY,
  };

  it("counts every order still in received, even ones there before the screen loaded", () => {
    const orders = [{ status: "received" }, { status: "received" }, { status: "preparing" }];
    expect(pendingAlerts({ ...base, orders }).waitingOrders).toBe(2);
  });

  it("does not ring for an old booking pulled in when the today window moves past midnight", () => {
    // Even if such a booking were ever marked arrived, it has no "New" badge
    // (so no "Got it"), so it must not keep the chime going.
    const old = { id: "b-old", createdAt: new Date(NOW - 3 * DAY).toISOString() };
    const pending = pendingAlerts({
      ...base,
      bookings: [old],
      arrivedBookings: new Set(["b-old"]),
    });
    expect(pending.unacknowledgedArrivals).toBe(0);
  });

  it("rings for arrived, unacknowledged bookings and messages only", () => {
    const b1 = { id: "b1", createdAt: new Date(NOW - 60_000).toISOString() };
    const b2 = { id: "b2", createdAt: new Date(NOW - 60_000).toISOString() };
    const pending = pendingAlerts({
      ...base,
      bookings: [b1, b2],
      messages: [{ id: "m1" }, { id: "m2" }],
      // b2 / m2 were already there at the first load (not arrivals).
      arrivedBookings: new Set(["b1"]),
      arrivedMessages: new Set(["m1"]),
    });
    expect(pending.unacknowledgedArrivals).toBe(2);
    const acked = pendingAlerts({
      ...base,
      bookings: [b1],
      messages: [{ id: "m1" }],
      arrivedBookings: new Set(["b1"]),
      arrivedMessages: new Set(["m1"]),
      acks: { [ackKey.booking("b1")]: NOW, [ackKey.message("m1")]: NOW },
    });
    expect(acked.unacknowledgedArrivals).toBe(0);
  });
});
