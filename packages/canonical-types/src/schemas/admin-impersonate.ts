import { z } from "zod";

/** Cockpit tenant detail — impersonate (FRONTEND_SPEC.md §7.2). The `admin_actions` audit row is written on the request itself, before the session is granted. */
export const adminImpersonateSchema = z.object({
  tenant_id: z.string().min(1),
  reason: z.string().trim().min(1, "A reason is required for the audit log").max(1000),
});

export type AdminImpersonate = z.infer<typeof adminImpersonateSchema>;
