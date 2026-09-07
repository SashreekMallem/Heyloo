import { z } from "zod";

export const CARRIERS = ["att", "verizon", "tmobile", "other_landline"] as const;

/** Phone setup carrier step (FRONTEND_SPEC.md §6.7). Default forwarding mode is `conditional` — see `CarrierForwardingCard`. */
export const phoneForwardingSetupSchema = z.object({
  carrier: z.enum(CARRIERS),
  forwarding_mode: z.enum(["conditional", "full"]).default("conditional"),
});

export type PhoneForwardingSetup = z.infer<typeof phoneForwardingSetupSchema>;
