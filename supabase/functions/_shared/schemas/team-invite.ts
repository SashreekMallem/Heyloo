import { z } from "zod";

/**
 * `/api-team-invite` request body (docs/audit/FIX_REQUESTS.md — team
 * invite). `role` deliberately excludes 'owner' — this endpoint invites a
 * TEAMMATE, never a second tenant owner (ownership transfer, if ever
 * built, is a separate, more sensitive flow).
 */
export const TeamInviteRequestSchema = z.object({
  email: z.string().trim().max(320).email(),
  role: z.enum(["admin", "member"]),
});

export type TeamInviteRequest = z.infer<typeof TeamInviteRequestSchema>;
