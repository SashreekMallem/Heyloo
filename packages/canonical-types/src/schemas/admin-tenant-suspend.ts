import { z } from "zod";

export const adminTenantSuspendSchema = z.object({
  tenant_id: z.string().min(1),
  reason: z.string().trim().min(1, "A reason is required").max(1000),
});

export type AdminTenantSuspend = z.infer<typeof adminTenantSuspendSchema>;
