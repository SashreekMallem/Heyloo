import { z } from "zod";

/**
 * `job-outreach-review-score`'s classifier output (OUTREACH-2 —
 * docs/research/CUSTOMER_ACQUISITION_TOOLS_2026.md recommendation #2:
 * "review-mining filter for phone/voicemail complaints"). A cheap Claude
 * pass reads a lead's Google reviews and scores how strongly they signal
 * "customers complain about phone access" (unanswered calls, voicemail,
 * no call back, on hold, hard to reach) — this is the boundary that
 * response gets validated against before anything is trusted or written.
 *
 * `evidence[].snippet` is validated by this schema for shape only (a
 * non-empty, bounded string) — the STRONGER guarantee, that every snippet
 * is an actual substring of a real review the lead has (never invented by
 * the model), is enforced separately in `job-outreach-review-score/
 * handler.ts` after this schema parses, since that check needs the
 * original review text this schema doesn't carry.
 */
export const ReviewComplaintEvidenceSchema = z.object({
  snippet: z.string().trim().min(1).max(500),
  rating: z.number().min(0).max(5).optional(),
  date: z.string().trim().min(1).max(100).optional(),
});
export type ReviewComplaintEvidence = z.infer<typeof ReviewComplaintEvidenceSchema>;

export const ReviewScoreClassificationSchema = z.object({
  score: z.number().min(0).max(1),
  // "1-3 quoted snippets" (task instruction) — zero is allowed too, for a
  // score near 0 with no complaint to quote at all.
  evidence: z.array(ReviewComplaintEvidenceSchema).max(3),
});
export type ReviewScoreClassification = z.infer<typeof ReviewScoreClassificationSchema>;
