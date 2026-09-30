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

/**
 * `admin_actions.target_type` CHECK values. Keep in sync with the table's
 * constraint (20260907130100_tenancy.sql, widened by
 * 20260930210600_qa2_backend_realtime_and_audit_types.sql; a test compares
 * this list with those files). A type outside the list is stored as "other"
 * with the original kept in `after._target_type`, so an unforeseen call site
 * can never fail the audit insert (23514) after its mutation has already run.
 */
export const ADMIN_ACTION_TARGET_TYPES: readonly string[] = [
  "tenant",
  "call",
  "booking",
  "order",
  "referral",
  "agent_template",
  "support_request",
  "payout",
  "campaign",
  "flag",
  "lead",
  "suppression_list",
  "other",
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * QA-2 COCKPIT-F02: the other reasons an admin audit insert can fail after the
 * mutation succeeded. `target_id` is a uuid column, but the pricing edit
 * passes a vertical slug ("dental") and platform-settings edits pass none;
 * `target_type` had a CHECK that did not list "lead" / "suppression_list".
 * A non-uuid target is bound as NULL and preserved as `after._target_ref`.
 */
export function normalizeAuditTarget(params: {
  targetType: string;
  targetId?: string | undefined;
  after?: unknown;
}): { targetType: string; targetId: string | null; after: unknown } {
  const extra: Record<string, string> = {};
  let targetType = params.targetType;
  if (!ADMIN_ACTION_TARGET_TYPES.includes(targetType)) {
    extra["_target_type"] = targetType;
    targetType = "other";
  }
  let targetId: string | null = null;
  if (params.targetId !== undefined && params.targetId !== null) {
    if (UUID_RE.test(params.targetId)) targetId = params.targetId;
    else extra["_target_ref"] = params.targetId;
  }
  let after = params.after;
  if (Object.keys(extra).length > 0) {
    if (after === undefined || after === null) after = extra;
    else if (isPlainObject(after)) after = { ...after, ...extra };
    else after = { value: after, ...extra };
  }
  return { targetType, targetId, after };
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
  const target = normalizeAuditTarget(params);
  await sql`
    insert into public.admin_actions (admin_user_id, action, target_type, target_id, before, after, ip_address, user_agent)
    values (
      ${params.adminUserId}, ${params.action}, ${target.targetType}, ${target.targetId},
      ${params.before !== undefined ? params.before : null}::jsonb,
      ${target.after !== undefined ? target.after : null}::jsonb,
      ${normalizeClientIp(params.ipAddress)}::inet, ${params.userAgent ?? null}
    )
  `;
}
