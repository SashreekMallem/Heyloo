import { z } from "zod";

/** `/mfa/challenge` — AAL1→AAL2 step-up (FRONTEND_SPEC.md §9.1). */
export const mfaChallengeSchema = z.object({
  code: z.string().length(6, "Enter the 6-digit code from your authenticator app"),
});

export type MfaChallenge = z.infer<typeof mfaChallengeSchema>;
