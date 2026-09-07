import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zInboundWebhookEnvelope, zWebhookSource } from "./webhooks.js";

describe("zWebhookSource", () => {
  it("accepts every declared source", () => {
    for (const s of ["retell", "stripe", "twilio", "outreach", "pos"] as const) {
      expect(zWebhookSource.parse(s)).toBe(s);
    }
  });

  it("rejects an unknown source", () => {
    expect(() => zWebhookSource.parse("paypal")).toThrow();
  });
});

describe("zInboundWebhookEnvelope factory", () => {
  const payloadSchema = z.object({ call_id: z.string(), event: z.string() });
  const envelopeSchema = zInboundWebhookEnvelope(payloadSchema);

  it("accepts a well-formed envelope wrapping the given payload schema", () => {
    expect(
      envelopeSchema.parse({
        source: "retell",
        eventId: "call_abc123:call_ended",
        eventType: "call_ended",
        receivedAt: "2026-09-07T14:03:12Z",
        signatureVerified: true,
        payload: { call_id: "call_abc123", event: "call_ended" },
      }),
    ).toBeTruthy();
  });

  it("rejects signatureVerified: false (envelopes only exist post-verification)", () => {
    expect(() =>
      envelopeSchema.parse({
        source: "retell",
        eventId: "call_abc123:call_ended",
        eventType: "call_ended",
        receivedAt: "2026-09-07T14:03:12Z",
        signatureVerified: false,
        payload: { call_id: "call_abc123", event: "call_ended" },
      }),
    ).toThrow();
  });

  it("rejects a payload that fails the wrapped payload schema", () => {
    expect(() =>
      envelopeSchema.parse({
        source: "retell",
        eventId: "x",
        eventType: "call_ended",
        receivedAt: "2026-09-07T14:03:12Z",
        signatureVerified: true,
        payload: { call_id: "call_abc123" }, // missing `event`
      }),
    ).toThrow();
  });
});
