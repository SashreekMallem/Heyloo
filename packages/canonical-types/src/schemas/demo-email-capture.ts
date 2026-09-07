import { z } from "zod";

/** `/demo` "email me this demo" capture form (FRONTEND_SPEC.md §3.4). */
export const demoEmailCaptureSchema = z.object({
  email: z.email("Enter a valid email address"),
});

export type DemoEmailCapture = z.infer<typeof demoEmailCaptureSchema>;
