import { z } from "zod";

/** Agent → Manual Mode (FRONTEND_SPEC.md §6.6). Two-step explain-then-confirm — `acknowledged_consequence` must be `true` to submit. */
export const manualModeToggleSchema = z.object({
  enabled: z.boolean(),
  acknowledged_consequence: z.literal(true),
});

export type ManualModeToggle = z.infer<typeof manualModeToggleSchema>;
