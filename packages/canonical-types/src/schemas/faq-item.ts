import { z } from "zod";

/** Agent → FAQ, one Q/A row (FRONTEND_SPEC.md §6.6). */
export const faqItemSchema = z.object({
  question: z.string().trim().min(1, "Question is required").max(500),
  answer: z.string().trim().min(1, "Answer is required").max(2000),
});

export type FaqItem = z.infer<typeof faqItemSchema>;
