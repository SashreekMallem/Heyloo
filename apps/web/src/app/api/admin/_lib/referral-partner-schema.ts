import { z } from "zod";

/**
 * Local mirror of the DB CHECK constraints on `referral_partners`/
 * `referral_partner_vertical_overrides` (`supabase/migrations/
 * 20260910140000_referral_commission_recurring.sql`) — `packages/
 * canonical-types` has no schema for these yet (neither table has a
 * `zod` schema anywhere in that package); a runtime boundary validator
 * here per CLAUDE.md Rule 1 rather than trusting the client. Not owned by
 * this cluster to move into `canonical-types` itself — see
 * `docs/audit/FIX_REQUESTS.md`.
 */
export const partnerCommissionTermsSchema = z.object({
  rate_bps: z.number().int().min(0).max(10000).nullable(),
  commission_base: z.enum(["gross_profit", "revenue"]),
  duration_months: z.number().int().positive().nullable(),
});
export type PartnerCommissionTerms = z.infer<typeof partnerCommissionTermsSchema>;

export const VERTICAL_OVERRIDE_VERTICALS = [
  "auto",
  "vet",
  "legal",
  "dental",
  "real_estate",
  "motel",
  "restaurant",
  "generic",
] as const;

export const partnerVerticalOverrideSchema = z.object({
  rate_bps: z.number().int().min(0).max(10000).nullable().optional(),
  commission_base: z.enum(["gross_profit", "revenue"]).nullable().optional(),
  duration_months: z.number().int().positive().nullable().optional(),
});
export type PartnerVerticalOverrideInput = z.infer<typeof partnerVerticalOverrideSchema>;
