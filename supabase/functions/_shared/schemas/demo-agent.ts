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

export const DemoAgentRequestSchema = z.union([ConfirmDemoRequestSchema, CreateDemoRequestSchema]);
export type CreateDemoRequest = z.infer<typeof CreateDemoRequestSchema>;
export type ConfirmDemoRequest = z.infer<typeof ConfirmDemoRequestSchema>;
