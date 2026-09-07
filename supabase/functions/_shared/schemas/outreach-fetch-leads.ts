import { z } from "zod";

/** `/api-outreach-fetch-leads` request (BACKEND_SPEC §1.8, T8 step 1). One
 * call fetches from exactly one source — the caller (admin UI) picks
 * Apollo for Apollo-strong verticals or Outscraper for Apollo-weak ones
 * (restaurant/motel) per MASTER_PLAN's guidance; this endpoint doesn't
 * guess that mapping itself since an admin operator may deliberately want
 * to try either source for any vertical. */
export const FetchLeadsRequestSchema = z.union([
  z.object({
    source: z.literal("apollo"),
    vertical: z.string().min(1),
    person_titles: z.array(z.string()).optional(),
    person_locations: z.array(z.string()).optional(),
    organization_domains: z.array(z.string()).optional(),
    per_page: z.number().int().min(1).max(100).optional(),
    enrich: z.boolean().optional(),
  }),
  z.object({
    source: z.literal("outscraper"),
    vertical: z.string().min(1),
    query: z.string().min(1),
    limit: z.number().int().min(1).max(500).optional(),
  }),
]);

export type FetchLeadsRequest = z.infer<typeof FetchLeadsRequestSchema>;
