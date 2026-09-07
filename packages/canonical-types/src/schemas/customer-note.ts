import { z } from "zod";

/** Customer detail "log a note" — lightweight free-text, not a support ticket (FRONTEND_SPEC.md §6.5). */
export const customerNoteSchema = z.object({
  customer_id: z.string().min(1),
  note: z.string().trim().min(1, "Note cannot be empty").max(2000),
});

export type CustomerNote = z.infer<typeof customerNoteSchema>;
