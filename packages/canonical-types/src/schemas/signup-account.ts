import { z } from "zod";

/** Signup step 3 (FRONTEND_SPEC.md §4.3). */
export const signupAccountSchema = z.object({
  owner_name: z.string().trim().min(1, "Your name is required").max(200),
  email: z.email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  tos_accepted: z.literal(true, "You must accept the Terms of Service"),
});

export type SignupAccount = z.infer<typeof signupAccountSchema>;
