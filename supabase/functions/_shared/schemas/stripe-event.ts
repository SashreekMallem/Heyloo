import { z } from "zod";

/**
 * Minimal Stripe `Event` envelope (`/webhooks-stripe` — BACKEND_SPEC §7.4).
 * Deliberately loose on `data.object` (`z.record` passthrough) — each
 * handled event type (checkout.session.completed, customer.subscription.*,
 * invoice.paid, invoice.payment_failed, charge.succeeded, payout.paid)
 * narrows it further inline. VERIFY (docs/VERIFY.md): confirm
 * `STRIPE_API_VERSION` pin and exact per-event-type object shapes against
 * Stripe's live API reference before go-live (egress-blocked here) — the
 * top-level `Event` envelope shape itself (`id`, `type`, `data.object`,
 * `livemode`) has been stable for years and is training-knowledge-confident.
 */
export const StripeEventSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    livemode: z.boolean().optional(),
    data: z.object({
      object: z.record(z.string(), z.unknown()),
    }),
  })
  .passthrough();

export type StripeEvent = z.infer<typeof StripeEventSchema>;
