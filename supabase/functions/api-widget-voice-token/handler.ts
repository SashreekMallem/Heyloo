import type { RetellFetch } from "../_shared/providers/retell.ts";
import { createWebCall } from "../_shared/providers/retell.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";
import { verifyWidgetToken } from "../_shared/widget-token.ts";

/**
 * `/api-widget-voice-token` (BUILD_PLAN Cluster W — the widget's Voice
 * mode). Mints a Retell web-call token for the TENANT's own real,
 * published agent, the same way `api-tenant-test-call/handler.ts` does for
 * the authenticated dashboard's "test your agent" page — the only
 * difference is how the caller is authorized: that route trusts a Supabase
 * user JWT's `app_metadata.tenant_id`; this one is called from an
 * arbitrary third-party website with no Supabase session at all, so it
 * independently re-verifies the `widget_token`
 * (`apps/web/src/lib/widget/session-token.ts` mints it only after checking
 * `Origin` + `widget_public_key`; see `docs/audit/CHANNELS_REQUESTS.md`
 * item 4) rather than trusting any caller-supplied tenant id.
 * `verify_jwt: false` (`index.ts`) — this function is publicly reachable
 * by design, exactly like `api-demo-agent`.
 */
export interface WidgetVoiceTokenDeps {
  retellFetch: RetellFetch;
  retellApiKey: string;
  widgetTokenSecret: string;
  logger: Logger;
  now?: () => Date;
}

export type WidgetVoiceTokenResult =
  | { status: 200; body: { access_token: string; call_id: string } }
  | { status: 401; body: { error: "expired_widget_token" } }
  | {
      status: 403;
      body: {
        error: "bad_signature_widget_token" | "malformed_widget_token" | "widget_voice_disabled";
      };
    }
  | { status: 404; body: { error: "agent_not_published" } }
  | { status: 502; body: { error: "call_token_unavailable" } };

export async function handleWidgetVoiceToken(
  sql: SqlClient,
  widgetToken: string | undefined,
  deps: WidgetVoiceTokenDeps,
): Promise<WidgetVoiceTokenResult> {
  const verified = await verifyWidgetToken(widgetToken, deps.widgetTokenSecret, deps.now);
  if (!verified.ok) {
    if (verified.reason === "expired")
      return { status: 401, body: { error: "expired_widget_token" } };
    return {
      status: 403,
      body: {
        error:
          verified.reason === "bad_signature"
            ? "bad_signature_widget_token"
            : "malformed_widget_token",
      },
    };
  }

  const tenantRows = await sql<{
    widget_enabled: boolean;
    widget_public_key: string | null;
    retell_agent_id: string | null;
    disclosure_line: string | null;
  }>`
    select
      t.widget_enabled,
      t.widget_public_key,
      ac.retell_agent_id,
      at.disclosure_line
    from public.tenants t
    left join public.agent_configs ac on ac.tenant_id = t.id
    left join public.agent_templates at on at.id = ac.template_id
    where t.id = ${verified.payload.tenant_id}
    limit 1
  `;
  const tenantRow = tenantRows[0];

  // Re-check widget_enabled + the public key still matches what the token
  // was minted for — cheap defense against a token minted just before the
  // tenant disabled the widget or rotated widget_public_key, still inside
  // its own short TTL.
  if (
    !tenantRow?.widget_enabled ||
    tenantRow.widget_public_key !== verified.payload.widget_public_key
  ) {
    return { status: 403, body: { error: "widget_voice_disabled" } };
  }
  if (!tenantRow.retell_agent_id) {
    return { status: 404, body: { error: "agent_not_published" } };
  }

  const callResult = await createWebCall(deps.retellFetch, deps.retellApiKey, {
    agent_id: tenantRow.retell_agent_id,
    ...(tenantRow.disclosure_line
      ? { retell_llm_dynamic_variables: { disclosure_line: tenantRow.disclosure_line } }
      : {}),
  });
  const callBody = callResult.body as { access_token?: string; call_id?: string };
  if (!callResult.ok || !callBody.access_token || !callBody.call_id) {
    deps.logger.error("widget_voice_token_web_call_failed", {
      tenant_id: verified.payload.tenant_id,
      status: callResult.status,
    });
    return { status: 502, body: { error: "call_token_unavailable" } };
  }

  // Same posture as api-tenant-test-call: the real call_logs row is
  // created by voice-events' existing webhook path once Retell's own
  // events arrive (call_logs.channel = 'web' per §13.2 — that tagging is
  // this same task's dashboard/migration reading, not written here, to
  // avoid a second call_logs insert racing that webhook).
  deps.logger.info("widget_voice_token_web_call_started", {
    tenant_id: verified.payload.tenant_id,
    call_id: callBody.call_id,
  });

  return { status: 200, body: { access_token: callBody.access_token, call_id: callBody.call_id } };
}
