// Cross-function-folder import — the same established pattern as
// worker-tick importing worker-adapter-push: the auto-republish runs the
// exact code the owner's "Publish changes" button runs.

import { AGENT_COMPILER_VERSION } from "../_shared/compiler/template-compiler.ts";
import type { SqlClient } from "../_shared/types.ts";
import { handlePublishAgent, type PublishAgentDeps } from "../api-tenant-agent-publish/handler.ts";

/**
 * SPEED-1 (docs/BUILD_NOTES.md): owners no longer have to press "Publish
 * changes" for platform updates. A published Retell agent only changes when
 * it is rebuilt, so before this a compiler/template improvement reached a
 * tenant's calls only if its owner noticed the banner and pressed the
 * button (Imperial's 2026-10-01 test call ran a two-day-old agent).
 *
 * Every run picks up to `batchSize` active tenants whose published agent is
 * behind: compiled with an older `AGENT_COMPILER_VERSION` (or never
 * stamped), or published before the owner's last call-language change (the
 * one owner setting baked into the agent). Real tenants go first. Each is
 * republished through `handlePublishAgent` with the previous Retell agent
 * KEPT (never deleted here), so a bad upgrade can be rolled back by
 * pointing the tenant at its old agent.
 *
 * `agent_configs.auto_republish_attempted_at` is the claim: a tenant is
 * skipped for 6 hours after an attempt, so two overlapping runs never
 * rebuild the same tenant and a failing one is retried, not hammered. A
 * success clears the version gap, so it is not picked again.
 */

export interface AutoRepublishDeps extends PublishAgentDeps {
  batchSize?: number;
}

export interface AutoRepublishTally {
  candidates: number;
  republished: number;
  failed: number;
}

const RETRY_AFTER = "6 hours";

export async function runAutoRepublish(
  sql: SqlClient,
  deps: AutoRepublishDeps,
): Promise<AutoRepublishTally> {
  const batchSize = deps.batchSize ?? 4;

  // Claim atomically: only rows still unclaimed (or whose last attempt is
  // older than RETRY_AFTER) are stamped and returned.
  const claimed = await sql<{ tenant_id: string; slug: string }>`
    with due as (
      select ac.tenant_id
      from public.agent_configs ac
      join public.tenants t on t.id = ac.tenant_id
      where t.deleted_at is null
        and t.status = 'active'
        and ac.published_at is not null
        and ac.retell_agent_id is not null
        and (
          ac.compiled_with_version is null
          or ac.compiled_with_version < ${AGENT_COMPILER_VERSION}
          or (t.language_config ->> 'changed_at')::timestamptz > ac.published_at
        )
        and (
          ac.auto_republish_attempted_at is null
          or ac.auto_republish_attempted_at < now() - ${RETRY_AFTER}::interval
        )
      order by t.is_test asc, ac.published_at asc
      limit ${batchSize}
      for update of ac skip locked
    )
    update public.agent_configs ac
    set auto_republish_attempted_at = now(), auto_republish_error = null
    from due, public.tenants t
    where ac.tenant_id = due.tenant_id and t.id = ac.tenant_id
    returning ac.tenant_id, t.slug
  `;

  let republished = 0;
  let failed = 0;
  for (const row of claimed) {
    let error: string | null = null;
    try {
      const result = await handlePublishAgent(sql, row.tenant_id, deps, {
        deleteSuperseded: false,
      });
      if (result.status !== 200) error = "error" in result.body ? result.body.error : "failed";
    } catch (e) {
      error = e instanceof Error ? e.message.slice(0, 300) : "exception";
    }
    if (error) {
      failed++;
      await sql`
        update public.agent_configs set auto_republish_error = ${error}
        where tenant_id = ${row.tenant_id}
      `;
      deps.logger.error("agent_auto_republish_failed", {
        tenant_id: row.tenant_id,
        slug: row.slug,
        error,
      });
    } else {
      republished++;
      deps.logger.info("agent_auto_republished", { tenant_id: row.tenant_id, slug: row.slug });
    }
  }

  return { candidates: claimed.length, republished, failed };
}
