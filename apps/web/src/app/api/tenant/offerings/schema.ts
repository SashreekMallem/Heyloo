import { offeringSchema } from "@heyloo/canonical-types";
import { z } from "zod";

/** Shared by `route.ts` (create) and `[id]/route.ts` (update) — kept out of
 * either `route.ts` file since Next.js route modules may only export the
 * HTTP-method handlers plus a small documented config set. */
export const offeringMetadataSchema = z
  .object({
    modifiers: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(100),
          price_cents: z.number().int().min(0).optional(),
        }),
      )
      .optional(),
    allergens: z.array(z.string().trim().min(1).max(100)).optional(),
  })
  .catchall(z.unknown());

export const offeringWriteSchema = offeringSchema.omit({ resource_id: true }).extend({
  category: z.string().trim().min(1).max(200).nullish(),
  resource_type_required: z.enum(["chair", "room", "table", "bay", "staff", "agent"]).nullish(),
  active: z.boolean().default(true),
  metadata: offeringMetadataSchema.default({}),
});

export const offeringUpdateSchema = offeringWriteSchema.partial();
