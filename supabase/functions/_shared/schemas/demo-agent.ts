import { z } from "zod";

/** `/api-demo-agent` request (BACKEND_SPEC §7.8 + MASTER_SPEC §2's binding
 * "review-first" patch: the scrape/summary phase and the token-issuance
 * phase are two separate calls, discriminated by whether `demo_session_id`
 * is present — see api-demo-agent/handler.ts). */
export const CreateDemoRequestSchema = z.object({
  business_name: z.string().min(1),
  url: z.string().min(1),
  vertical: z.string().optional(),
});

export const ConfirmDemoRequestSchema = z.object({
  demo_session_id: z.string().min(1),
  confirmed: z.literal(true),
  edits: z
    .object({
      business_name: z.string().optional(),
      hours_detected: z.string().optional(),
      services_detected: z.array(z.string()).optional(),
    })
    .optional(),
});

/**
 * The business types a visitor can pick for the live demo (DEMO-2). A strict
 * allowlist: it is the only thing that selects which demo tenant's agent a
 * public request may reach, so anything else is rejected, never mapped.
 * Mirrored (as plain data) by `apps/web/src/components/demo/demo-verticals.ts`.
 */
export const DEMO_VERTICALS = [
  "auto",
  "dental",
  "vet",
  "legal",
  "real_estate",
  "motel",
  "restaurant",
  "generic",
] as const;
export type DemoVertical = (typeof DEMO_VERTICALS)[number];

/** SITE-3 / DEMO-2: the marketing site's one-click "Talk to Heyloo" demo. No scrape and no confirmation card; `vertical` picks the demo tenant (default `auto`, what SITE-3 builds sent implicitly). */
export const InstantDemoRequestSchema = z.object({
  instant: z.literal(true),
  vertical: z.enum(DEMO_VERTICALS).default("auto"),
});

export const DemoAgentRequestSchema = z.union([
  ConfirmDemoRequestSchema,
  InstantDemoRequestSchema,
  CreateDemoRequestSchema,
]);
export type InstantDemoRequest = z.infer<typeof InstantDemoRequestSchema>;
export type CreateDemoRequest = z.infer<typeof CreateDemoRequestSchema>;
export type ConfirmDemoRequest = z.infer<typeof ConfirmDemoRequestSchema>;
