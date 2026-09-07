import { z } from "zod";

export const supportTicketReplySchema = z.object({
  ticket_id: z.string().min(1),
  body: z.string().trim().min(1, "Reply cannot be empty").max(4000),
});

export type SupportTicketReply = z.infer<typeof supportTicketReplySchema>;
