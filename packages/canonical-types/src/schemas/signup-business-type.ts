import { z } from "zod";
import { zVertical } from "../vertical.js";

/** Signup step 1 (FRONTEND_SPEC.md §4.1). `business_type` reuses the canonical 8-vertical + generic enum. */
export const signupBusinessTypeSchema = z.object({
  business_type: zVertical,
  business_name: z.string().trim().min(1, "Business name is required").max(200),
});

export type SignupBusinessType = z.infer<typeof signupBusinessTypeSchema>;
