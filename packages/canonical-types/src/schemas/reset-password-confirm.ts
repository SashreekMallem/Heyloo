import { z } from "zod";

export const resetPasswordConfirmSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters").max(200),
    confirm_password: z.string().min(8),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: "Passwords do not match",
    path: ["confirm_password"],
  });

export type ResetPasswordConfirm = z.infer<typeof resetPasswordConfirmSchema>;
