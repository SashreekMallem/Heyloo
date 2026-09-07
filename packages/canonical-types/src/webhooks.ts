/**
 * The generic webhook-event envelope every inbound webhook handler
 * (`/voice/inbound`, `/voice/tools`, `/voice/events`, `/webhooks/stripe`, ...)
 * normalizes into before the idempotent `webhook_events` dedup insert
 * (BACKEND_SPEC §1.5/§7: "unique (source, event_id)"). Provider-specific raw
 * payload shapes stay inside their owning `packages/adapters/<provider>`
 * package — this envelope is intentionally provider-agnostic.
 */

import { z } from "zod";
import { zIsoTimestamp } from "./primitives.js";

export const WEBHOOK_SOURCES = ["retell", "stripe", "twilio", "outreach", "pos"] as const;
export type WebhookSource = (typeof WEBHOOK_SOURCES)[number];
export const zWebhookSource = z.enum(WEBHOOK_SOURCES);

export interface InboundWebhookEnvelope<TPayload = unknown> {
  source: WebhookSource;
  /** Dedup key — unique per (source, eventId). Convention: `${call_id}:${event}` for Retell (BACKEND_SPEC §7.3). */
  eventId: string;
  eventType: string;
  receivedAt: string;
  signatureVerified: true; // envelopes are only ever constructed after verification succeeds (fail-closed).
  payload: TPayload;
}

/** Factory: build a Zod schema for an envelope wrapping a specific, already-validated payload schema. */
export function zInboundWebhookEnvelope<PayloadSchema extends z.ZodType>(
  payloadSchema: PayloadSchema,
) {
  return z.object({
    source: zWebhookSource,
    eventId: z.string().min(1),
    eventType: z.string().min(1),
    receivedAt: zIsoTimestamp,
    signatureVerified: z.literal(true),
    payload: payloadSchema,
  });
}
