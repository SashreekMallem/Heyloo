import { z } from "zod";

/** `/portal/disclosure` — blocking FTC acknowledgment gate, versioned (FRONTEND_SPEC.md §8.4). */
export const ftcDisclosureAckSchema = z.object({
  policy_version: z.string().min(1),
  acknowledged: z.literal(true),
});

export type FtcDisclosureAck = z.infer<typeof ftcDisclosureAckSchema>;
