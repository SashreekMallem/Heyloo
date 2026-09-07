import { z } from "zod";

export const supportTicketCreateSchema = z.object({
  subject: z.string().trim().min(1, "Subject is required").max(200),
  body: z.string().trim().min(1, "Please describe the issue").max(4000),
  call_id: z.string().min(1).optional(),
  booking_id: z.string().min(1).optional(),
});

export type SupportTicketCreate = z.infer<typeof supportTicketCreateSchema>;
