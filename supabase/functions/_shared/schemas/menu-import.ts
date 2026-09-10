import { z } from "zod";

/**
 * `/api-menu-import` request body (GAP_REGISTER Cluster G item 3 — menu
 * import from PDF/photo/URL). CONTRACT NOTE (docs/audit/FIX_REQUESTS.md,
 * Cluster E entry): the dashboard UI + its proxy
 * (`apps/web/src/app/api/tenant/offerings/import/route.ts`) are already
 * built and call this endpoint with `{raw_text: string}` — the browser
 * reads an uploaded file as text client-side today, so `raw_text` is the
 * REQUIRED, already-wired primary path and is validated first/preferred.
 * `source` (url/file-with-vision) is this task's own richer additive mode
 * for when the client is upgraded to send an actual PDF/photo — both are
 * accepted so the already-shipped UI keeps working unchanged today.
 */
const ImageMediaTypeSchema = z.enum(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const UrlSourceSchema = z.object({
  kind: z.literal("url"),
  url: z.url().refine((u) => /^https?:\/\//i.test(u), { message: "url must be http(s)" }),
});

const FileSourceSchema = z.object({
  kind: z.literal("file"),
  media_type: z.union([ImageMediaTypeSchema, z.literal("application/pdf")]),
  // Base64-encoded file bytes. ~10MB (Anthropic's own per-file cap for a
  // direct base64 request body) base64-inflates to ~14M characters —
  // capped here so an oversized upload fails fast with a clear 422 instead
  // of a slow round trip to Anthropic that would reject it anyway.
  data_base64: z.string().min(1).max(14_000_000),
});

export const MenuImportRequestSchema = z
  .object({
    raw_text: z.string().trim().min(1).max(50_000).optional(),
    source: z.discriminatedUnion("kind", [UrlSourceSchema, FileSourceSchema]).optional(),
  })
  .refine((v) => !!v.raw_text || !!v.source, {
    message: "either raw_text or source is required",
  });

export type MenuImportRequest = z.infer<typeof MenuImportRequestSchema>;

/**
 * One extracted candidate menu item — NEVER auto-published; the tenant
 * owner confirms/edits each candidate in the dashboard before the proxy's
 * `POST /api/tenant/offerings/bulk` persists it. Field shape matches
 * `apps/web/src/app/api/tenant/offerings/schema.ts`'s `offeringWriteSchema`
 * exactly (per the FIX_REQUESTS.md contract) so the proxy reshapes nothing
 * beyond nesting `allergens`/`modifiers` under `metadata`.
 */
export const MenuImportCandidateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(200).optional(),
  price_cents: z.number().int().min(0).max(100_000_00).optional(),
  duration_minutes: z.number().int().positive().max(1440).optional(),
  allergens: z.array(z.string().trim().min(1).max(100)).optional(),
  modifiers: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        price_cents: z.number().int().min(0).optional(),
      }),
    )
    .optional(),
});

export const MenuImportExtractionSchema = z.object({
  items: z.array(MenuImportCandidateSchema).max(500),
});

export type MenuImportCandidate = z.infer<typeof MenuImportCandidateSchema>;
