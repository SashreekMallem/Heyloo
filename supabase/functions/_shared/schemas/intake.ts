import { z } from "zod";

/**
 * `POST /api-intake/{token}` request body (GAP_REGISTER Cluster G item 4).
 * Field names/shape match exactly what the already-built public intake
 * form page sends (docs/audit/FIX_REQUESTS.md, Cluster E entry) —
 * `date_of_birth` (not `dob`) and `insurance_group_id` (not
 * `insurance_group_number`).
 */
export const IntakeSubmitBodySchema = z.object({
  date_of_birth: z.iso.date(),
  insurance_provider: z.string().trim().min(1).max(200).optional(),
  insurance_member_id: z.string().trim().min(1).max(100).optional(),
  insurance_group_id: z.string().trim().min(1).max(100).optional(),
});

export type IntakeSubmitBody = z.infer<typeof IntakeSubmitBodySchema>;
