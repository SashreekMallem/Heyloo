import { z } from "zod";

/** `/demo` step 1 (FRONTEND_SPEC.md §3.4). */
export const demoRequestSchema = z.object({
  business_name: z.string().trim().min(1, "Business name is required").max(200),
  // http(s) only: this URL is fetched server-side by the demo agent builder, so
  // `file:`, `ftp:`, `gopher:` and the like are refused at the boundary (QA SEC-04).
  website_url: z.url({
    protocol: /^https?$/,
    error: "Enter a valid web address starting with http:// or https://, e.g. https://example.com",
  }),
});

export type DemoRequest = z.infer<typeof demoRequestSchema>;
