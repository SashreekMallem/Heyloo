import { z } from "zod";

export const resetPasswordConfirmSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters").max(200),
    // MAP-20: no length rule of its own — the refine below already requires it to equal `password`,
    // and a second min(8) message surfaced as raw zod text ("Too small: expected string...").
    confirm_password: z.string().min(1, "Confirm your new password"),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: "Passwords do not match",
    path: ["confirm_password"],
  });

export type ResetPasswordConfirm = z.infer<typeof resetPasswordConfirmSchema>;
