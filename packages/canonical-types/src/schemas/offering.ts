import { z } from "zod";
import { zCents } from "../primitives.js";

/** Agent → Services, one row of the `ServiceOfferingEditor` CRUD list (FRONTEND_SPEC.md §6.6). */
export const offeringSchema = z.object({
  name: z.string().trim().min(1, "Service name is required").max(200),
  duration_minutes: z.number().int().positive().optional(),
  price_cents: zCents.optional(),
  resource_id: z.string().min(1).optional(),
});

export type Offering = z.infer<typeof offeringSchema>;
