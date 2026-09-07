import { z } from "zod";

/** `/mfa/enroll` — forced TOTP enrollment for admins (FRONTEND_SPEC.md §9.1). */
export const mfaEnrollSchema = z.object({
  factor_id: z.string().min(1),
  code: z.string().length(6, "Enter the 6-digit code from your authenticator app"),
});

export type MfaEnroll = z.infer<typeof mfaEnrollSchema>;
