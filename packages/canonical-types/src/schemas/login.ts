import { z } from "zod";

/** `/login` (FRONTEND_SPEC.md §9.1). */
export const loginSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export type Login = z.infer<typeof loginSchema>;
