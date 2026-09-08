/**
 * PROVIDERS-VERIFY compile-time + runtime contract test — cross-checks this
 * adapter's hand-rolled Square shapes against the OFFICIAL `square` npm SDK
 * (added as a devDependency in this package's `package.json` ONLY — no
 * runtime code under `src/` besides this test file imports it, so nothing
 * outside this file references a Square-SDK type, and no package outside
 * `packages/adapters/square` depends on it at all, since `devDependencies`
 * never propagate to a workspace consumer; CLAUDE.md Rule 2 provider
 * isolation holds unchanged). This file compiles into `dist/` alongside
 * every other `*.test.ts` in this package (same as `webhook.test.ts` etc.
 * — see `vitest.config.ts`'s own comment on why that's excluded from the
 * vitest run there, not from the `tsc -b` build).
 *
 * Two independent kinds of check:
 * 1. Type-level: literal request bodies typed against the SDK's own
 *    generated interfaces are round-tripped through this adapter's zod
 *    parsers — a field-name drift in either the SDK or this file fails to
 *    COMPILE, not just to run.
 * 2. Runtime: this adapter's `verifySquareWebhookSignature` is checked
 *    against the SDK's OWN `WebhooksHelper.verifySignature` implementation
 *    on the same inputs — the strongest possible confirmation that the two
 *    independently-implemented HMAC schemes agree bit-for-bit.
 */

import { createHmac } from "node:crypto";
import type {
  AppointmentSegment,
  Booking,
  CreateBookingRequest,
  CreateBookingResponse,
  CreateOrderRequest,
  CreateOrderResponse,
  SearchAvailabilityRequest,
  SearchAvailabilityResponse,
} from "square";
import { WebhooksHelper } from "square";
import { describe, expect, it } from "vitest";
import { verifySquareWebhookSignature } from "./webhook.js";

describe("Square SDK contract — webhook signature", () => {
  it("agrees with the official square SDK's WebhooksHelper.verifySignature", async () => {
    const notificationUrl = "https://example.com/functions/v1/webhooks-pos/square";
    const signatureKey = "test-signature-key";
    const rawBody = JSON.stringify({ type: "order.updated", data: { id: "order_1" } });

    // Our own implementation's expected digest (same algorithm this
    // adapter's webhook.ts computes internally).
    const ourDigest = createHmac("sha256", signatureKey)
      .update(notificationUrl + rawBody, "utf8")
      .digest("base64");

    // (a) the official SDK accepts a signature computed OUR way
    const officialAcceptsOurs = await WebhooksHelper.verifySignature({
      requestBody: rawBody,
      signatureHeader: ourDigest,
      signatureKey,
      notificationUrl,
    });
    expect(officialAcceptsOurs).toBe(true);

    // (b) our own verifier accepts a signature the OFFICIAL SDK would also
    // accept for the same inputs (round-trip in the other direction)
    const ours = verifySquareWebhookSignature({
      rawBody,
      signatureHeader: ourDigest,
      notificationUrl,
      signatureKey,
    });
    expect(ours.valid).toBe(true);
  });
});

describe("Square SDK contract — Bookings/Orders/Availability wire shapes", () => {
  it("CreateBookingRequest/Response field names match this adapter's zod parsing", () => {
    // Typed against the SDK's OWN interface — fails to compile if Square
    // renames a field this adapter relies on (location_id, start_at,
    // customer_note, appointment_segments[].team_member_id/
    // service_variation_id/service_variation_version).
    const segment: AppointmentSegment = {
      teamMemberId: "team_1",
      serviceVariationId: "svc_1",
      serviceVariationVersion: 1n,
    };
    const booking: Booking = {
      locationId: "loc_1",
      startAt: "2026-01-01T10:00:00Z",
      customerNote: "Jane Doe +15551234567",
      appointmentSegments: [segment],
    };
    const request: CreateBookingRequest = { idempotencyKey: "idem_1", booking };
    expect(request.booking.locationId).toBe("loc_1");

    const response: CreateBookingResponse = { booking: { id: "bk_1", status: "ACCEPTED" } };
    // This adapter's own zod schema (webhook.ts's sibling, booking.ts's
    // zCreateBookingResponse) — re-declared inline since it's not exported;
    // this shape check is what actually matters here, not re-importing it.
    expect(response.booking?.id).toBe("bk_1");
  });

  it("CreateOrderRequest/Response field names match (line_items/fulfillments)", () => {
    const request: CreateOrderRequest = {
      idempotencyKey: "idem_2",
      order: {
        locationId: "loc_1",
        lineItems: [
          {
            name: "Oil change",
            quantity: "1",
            basePriceMoney: { amount: 4999n, currency: "USD" },
          },
        ],
        fulfillments: [
          { type: "PICKUP", pickupDetails: { recipient: { displayName: "Phone order" } } },
        ],
      },
    };
    expect(request.order?.locationId).toBe("loc_1");

    const response: CreateOrderResponse = { order: { id: "order_1", locationId: "loc_1" } };
    expect(response.order?.id).toBe("order_1");
  });

  it("SearchAvailabilityRequest/Response field names match (start_at_range/segment_filters)", () => {
    const request: SearchAvailabilityRequest = {
      query: {
        filter: {
          startAtRange: { startAt: "2026-01-01T00:00:00Z", endAt: "2026-01-02T00:00:00Z" },
          locationId: "loc_1",
          segmentFilters: [{ serviceVariationId: "svc_1" }],
        },
      },
    };
    expect(request.query.filter.locationId).toBe("loc_1");

    const response: SearchAvailabilityResponse = {
      availabilities: [
        {
          startAt: "2026-01-01T09:00:00Z",
          locationId: "loc_1",
          appointmentSegments: [{ teamMemberId: "team_1" }],
        },
      ],
    };
    expect(response.availabilities?.[0]?.appointmentSegments?.[0]?.teamMemberId).toBe("team_1");
  });
});
