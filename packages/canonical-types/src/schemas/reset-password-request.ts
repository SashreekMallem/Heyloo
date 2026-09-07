import { z } from "zod";

export const resetPasswordRequestSchema = z.object({
  email: z.email("Enter a valid email address"),
});

export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;
