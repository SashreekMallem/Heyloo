import type { SqlClient } from "./types.ts";

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const IPV6_CHARS_RE = /^[0-9a-fA-F:.]+$/;

// The WHATWG URL parser validates IPv6 literals (Node and Deno both).
function isIpv6(candidate: string): boolean {
  if (!candidate.includes(":") || candidate.length > 45 || !IPV6_CHARS_RE.test(candidate)) {
    return false;
  }
  try {
    new URL(`http://[${candidate}]/`);
    return true;
  } catch {
    return false;
  }
}

/**
 * QA-1 COCKPIT-F02 / BE-09: behind the Supabase gateway `x-forwarded-for` is a
 * comma-separated hop list ("35.202.184.100,35.202.184.100, 3.2.58.44"); the
 * whole list was cast to `inet`, Postgres rejected it (22P02), and EVERY admin
 * mutation 500'd with no audit row. Take the FIRST hop (the client), validate
 * it, and return null for anything unparseable so an odd header can never fail
 * the audit insert.
 */
export function normalizeClientIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim() ?? "";
  if (!first) return null;
  if (IPV4_RE.test(first)) return first;
  if (isIpv6(first)) return first;
  return null;
}

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
      ${params.before !== undefined ? params.before : null}::jsonb,
      ${params.after !== undefined ? params.after : null}::jsonb,
      ${normalizeClientIp(params.ipAddress)}::inet, ${params.userAgent ?? null}
    )
  `;
}
