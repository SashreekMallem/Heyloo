import type { SupabaseServerClient } from "@heyloo/supabase-client";

/**
 * SETTINGS-2: the one read of `agent_configs` both publish-status consumers
 * (`GET /api/tenant/agent/publish-status`, `GET /api/tenant/settings/checklist`)
 * need, including the new `compiled_with_version` stamp
 * (migration `20260929162000_agent_configs_compiled_with_version.sql`).
 *
 * The portal deploys independently of migrations, so a database that has not
 * applied that migration yet answers the select with Postgres `42703`
 * (undefined column; PostgREST also uses `PGRST204` for a column missing from
 * its schema cache): the read is retried without the column and reports the
 * version as `undefined` ("unknown, don't flag") instead of failing the badge.
 * A present-but-never-stamped column is `null` ("compiled before the stamp
 * existed" — flagged).
 */

export interface AgentConfigPublishRow {
  transfer_number: string | null;
  dynamic_variable_overrides: unknown;
  published_at: string | null;
  compiled_config: unknown;
  /** `undefined` = this database has no such column yet; `null` = never stamped. */
  compiled_with_version: number | null | undefined;
}

export type AgentConfigPublishRead =
  | { ok: true; row: AgentConfigPublishRow | null }
  | { ok: false };

const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);

export async function readAgentConfigForPublish(
  supabase: SupabaseServerClient,
  tenantId: string,
): Promise<AgentConfigPublishRead> {
  const withVersion = await supabase
    .from("agent_configs")
    .select(
      "transfer_number, dynamic_variable_overrides, published_at, compiled_config, compiled_with_version",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!withVersion.error) {
    const data = withVersion.data;
    if (!data) return { ok: true, row: null };
    return {
      ok: true,
      row: {
        transfer_number: data.transfer_number ?? null,
        dynamic_variable_overrides: data.dynamic_variable_overrides ?? null,
        published_at: data.published_at ?? null,
        compiled_config: data.compiled_config ?? null,
        // A response without the key at all (a stale mock, an old PostgREST
        // schema) is "unknown", never "unstamped".
        compiled_with_version:
          "compiled_with_version" in data ? (data.compiled_with_version ?? null) : undefined,
      },
    };
  }

  if (!MISSING_COLUMN_CODES.has(withVersion.error.code ?? "")) return { ok: false };

  const legacy = await supabase
    .from("agent_configs")
    .select("transfer_number, dynamic_variable_overrides, published_at, compiled_config")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (legacy.error) return { ok: false };
  const data = legacy.data;
  if (!data) return { ok: true, row: null };
  return {
    ok: true,
    row: {
      transfer_number: data.transfer_number ?? null,
      dynamic_variable_overrides: data.dynamic_variable_overrides ?? null,
      published_at: data.published_at ?? null,
      compiled_config: data.compiled_config ?? null,
      compiled_with_version: undefined,
    },
  };
}
