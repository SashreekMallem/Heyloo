import { describe, expect, it } from "vitest";
import {
  bookingIdempotencyKey,
  fnv1aHex,
  orderIdempotencyKey,
  stableStringify,
} from "./idempotency.ts";

describe("bookingIdempotencyKey", () => {
  it("joins call_id and start ISO with a colon", () => {
    expect(bookingIdempotencyKey("call_123", "2026-01-01T10:00:00.000Z")).toBe(
      "call_123:2026-01-01T10:00:00.000Z",
    );
  });
});

describe("stableStringify", () => {
  it("produces identical output regardless of key insertion order", () => {
    const a = { b: 1, a: 2, c: [{ y: 1, x: 2 }] };
    const b = { a: 2, c: [{ x: 2, y: 1 }], b: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });
});

describe("fnv1aHex", () => {
  it("is deterministic and produces an 8-char hex string", () => {
    const h1 = fnv1aHex("hello");
    const h2 = fnv1aHex("hello");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{8}$/);
  });

  it("differs for different input", () => {
    expect(fnv1aHex("hello")).not.toBe(fnv1aHex("world"));
  });
});

describe("orderIdempotencyKey", () => {
  it("is stable across key-order-different-but-content-identical item arrays", () => {
    const itemsA = [{ name: "Burger", qty: 2, offering_id: "o1" }];
    const itemsB = [{ offering_id: "o1", qty: 2, name: "Burger" }];
    expect(orderIdempotencyKey("call_1", itemsA)).toBe(orderIdempotencyKey("call_1", itemsB));
  });

  it("differs for a different call_id even with identical items", () => {
    const items = [{ name: "Burger", qty: 1 }];
    expect(orderIdempotencyKey("call_1", items)).not.toBe(orderIdempotencyKey("call_2", items));
  });

  it("differs when items actually differ", () => {
    expect(orderIdempotencyKey("call_1", [{ name: "Burger", qty: 1 }])).not.toBe(
      orderIdempotencyKey("call_1", [{ name: "Burger", qty: 2 }]),
    );
  });
});
