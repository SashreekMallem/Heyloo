import { z } from "zod";

/**
 * Twilio inbound-SMS webhook form fields (`/webhooks-twilio-sms` —
 * MASTER_SPEC §3.3). Twilio posts `application/x-www-form-urlencoded`, not
 * JSON — the Deno glue parses the raw body with `URLSearchParams` into a
 * plain object before this schema validates it. Field names match Twilio's
 * long-stable inbound-message webhook parameters; VERIFY (docs/VERIFY.md)
 * against Twilio's live docs before go-live (egress-blocked here) — only
 * the fields this handler reads are required, everything else is optional/
 * passthrough since Twilio sends many more (geo/carrier lookup fields etc.)
 * this system doesn't need.
 */
export const TwilioInboundSmsSchema = z
  .object({
    MessageSid: z.string().min(1),
    From: z.string().min(1),
    To: z.string().min(1),
    Body: z.string().default(""),
    NumMedia: z.string().optional(),
  })
  .passthrough();

export type TwilioInboundSms = z.infer<typeof TwilioInboundSmsSchema>;

export function formParamsToObject(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of params.entries()) out[key] = value;
  return out;
}
