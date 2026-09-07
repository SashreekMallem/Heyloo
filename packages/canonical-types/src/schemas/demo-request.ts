import { z } from "zod";

/** `/demo` step 1 (FRONTEND_SPEC.md §3.4). */
export const demoRequestSchema = z.object({
  business_name: z.string().trim().min(1, "Business name is required").max(200),
  website_url: z.url("Enter a valid URL, e.g. https://example.com"),
});

export type DemoRequest = z.infer<typeof demoRequestSchema>;
