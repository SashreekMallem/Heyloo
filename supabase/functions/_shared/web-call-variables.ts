import { buildInboundDynamicVariables } from "./inbound-dynamic-variables.ts";
import type { Logger, SqlClient } from "./types.ts";

/**
 * Per-call dynamic variables for a Retell WEB (browser) call.
 *
 * A web call never hits `/voice-inbound` (Retell only sends `call_inbound`
 * for phone calls), so without this the agent would answer a browser call
 * with none of the variables a phone call gets: hours context,
 * `current_date`/`current_weekday`/`upcoming_weekday_dates`, owner settings,
 * restaurant `menu_text`, the texting policy, the blank caller-history
 * strings, and so on. This runs the same `buildInboundDynamicVariables` that
 * `voice-inbound` and the instant demo use, with `fromNumber: null` because a
 * web call has no caller number to look up.
 *
 * `tenantId` must already be verified by the caller (a JWT's `app_metadata`,
 * a signed widget token, or an internal-secret-guarded admin route). This
 * function does not authorize anything. Returns `null` when no live tenant
 * row exists.
 */

/** Used when the agent's template has no `disclosure_line` of its own. */
export const DEFAULT_DISCLOSURE_LINE =
  "This call may be recorded, and you are speaking with an AI assistant.";

/** Retell dynamic variables are strings only (create-web-call: "key value pairs of string"). */
export function toStringVariables(vars: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined || value === null) continue;
    out[key] =
      typeof value === "string" ? value : Array.isArray(value) ? value.join(", ") : String(value);
  }
  return out;
}

interface WebCallTenantRow {
  tenant_id: string;
  business_name: string;
  vertical: string;
  timezone: string;
  business_hours: Record<string, unknown>;
  hours_exceptions: unknown[];
  manual_mode: boolean;
  language_primary: string;
  assistant_name: string | null;
  special_instructions: string | null;
  dynamic_variable_overrides: Record<string, unknown> | null;
  transfer_number: string | null;
  disclosure_line: string | null;
}

export async function buildWebCallDynamicVariables(params: {
  sql: SqlClient;
  logger: Logger;
  now: Date;
  tenantId: string;
}): Promise<Record<string, string> | null> {
  const { sql, logger, now, tenantId } = params;
  const rows = await sql<WebCallTenantRow>`
    select t.id as tenant_id, t.name as business_name, t.vertical, t.timezone, t.business_hours,
      t.hours_exceptions, t.manual_mode, coalesce(t.language_config->>'primary', 'en') as language_primary,
      ac.assistant_name, ac.special_instructions, ac.dynamic_variable_overrides, ac.transfer_number,
      at.disclosure_line
    from public.tenants t
    left join public.agent_configs ac on ac.tenant_id = t.id
    left join public.agent_templates at on at.id = ac.template_id
    where t.id = ${tenantId} and t.deleted_at is null
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;

  const vars = await buildInboundDynamicVariables({
    sql,
    logger,
    now,
    fromNumber: null,
    config: {
      tenantId: row.tenant_id,
      businessName: row.business_name,
      vertical: row.vertical,
      timezone: row.timezone,
      businessHours: row.business_hours,
      hoursExceptions: row.hours_exceptions,
      manualMode: row.manual_mode,
      languagePrimary: row.language_primary,
      assistantName: row.assistant_name,
      specialInstructions: row.special_instructions,
      dynamicVariableOverrides: row.dynamic_variable_overrides ?? {},
      disclosureLine: row.disclosure_line ?? DEFAULT_DISCLOSURE_LINE,
      transferNumber: row.transfer_number,
    },
  });
  return toStringVariables(vars);
}

/**
 * The variables to send on a web call: the full set when it builds, otherwise
 * (no tenant row, or the build throws) just the template's `disclosure_line`,
 * which is what web calls sent before. Never throws, so a variable problem
 * never blocks the call.
 */
export async function resolveWebCallDynamicVariables(params: {
  sql: SqlClient;
  logger: Logger;
  now: Date;
  tenantId: string;
  /** The template's disclosure line the caller already read, for the fallback. */
  fallbackDisclosureLine: string | null;
  /** Log event name prefix, e.g. `widget_voice_token`. */
  logPrefix: string;
}): Promise<Record<string, string> | undefined> {
  const { fallbackDisclosureLine, logPrefix, ...buildParams } = params;
  const fallback = fallbackDisclosureLine ? { disclosure_line: fallbackDisclosureLine } : undefined;
  try {
    const vars = await buildWebCallDynamicVariables(buildParams);
    if (vars) return vars;
    params.logger.warn(`${logPrefix}_dynamic_variables_no_tenant`, { tenant_id: params.tenantId });
  } catch (error) {
    params.logger.warn(`${logPrefix}_dynamic_variables_failed`, {
      tenant_id: params.tenantId,
      error: String(error),
    });
  }
  return fallback;
}
