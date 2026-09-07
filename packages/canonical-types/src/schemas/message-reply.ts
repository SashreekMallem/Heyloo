import { z } from "zod";

/** MASTER_SPEC.md §3.3/§3.10 — the tenant-facing customer message thread reply (SMS, two-way). */
export const messageReplySchema = z.object({
  customer_id: z.string().min(1),
  body: z.string().trim().min(1, "Message cannot be empty").max(1600),
});

export type MessageReply = z.infer<typeof messageReplySchema>;
