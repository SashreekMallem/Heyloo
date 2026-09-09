import type { SqlClient } from "./types.ts";

/** Append-only `admin_actions` audit log writer (BACKEND_SPEC §1.1/§7.7,
 * G15) — every mutating admin endpoint writes one row with before/after
 * snapshots. */
export async function writeAdminAction(
  sql: SqlClient,
  params: {
    adminUserId: string;
    action: string;
    targetType: string;
    targetId?: string;
    before?: unknown;
    after?: unknown;
    ipAddress?: string;
    userAgent?: string;
  },
): Promise<void> {
  await sql`
    insert into public.admin_actions (admin_user_id, action, target_type, target_id, before, after, ip_address, user_agent)
    values (
      ${params.adminUserId}, ${params.action}, ${params.targetType}, ${params.targetId ?? null},
      ${params.before !== undefined ? JSON.stringify(params.before) : null}::jsonb,
      ${params.after !== undefined ? JSON.stringify(params.after) : null}::jsonb,
      ${params.ipAddress ?? null}::inet, ${params.userAgent ?? null}
    )
  `;
}
