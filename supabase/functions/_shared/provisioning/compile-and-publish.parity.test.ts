import { describe, expect, it } from "vitest";
import { provisionTestTenant } from "../../api-admin-provision-test-tenant/handler.ts";
import { type ProvisionDeps, runProvisioningSaga } from "../../api-provision/handler.ts";
import { createLogger } from "../logger.ts";
import type { SqlClient } from "../types.ts";

/**
 * PARITY-1 (docs/BUILD_NOTES.md, deliverable 2): runs BOTH real entry
 * points — `api-provision`'s real customer saga and
 * `api-admin-provision-test-tenant`'s internal test-tenant path — against
 * the SAME fixture tenant (same id, same vertical, same active template
 * row, same webhook URLs) and asserts the Retell payloads each one sends
 * to `create-conversation-flow` and `create-agent` are byte-identical.
 * Both now delegate their compile -> create-agent mechanics to
 * `_shared/provisioning/compile-and-publish.ts` (this directory), so this
 * test is the guard against a future edit to only ONE caller silently
 * reintroducing the exact class of drift PARITY-1 was written to close
 * (CALL-5's `webhook_url` omission, SIGNUP-1's stale-agent date bug).
 */

const TENANT_ID = "tenant_parity_fixture";

const HEALTHY_TEMPLATE_ROW = {
  id: "tmpl_1",
  version: 1,
  compile_target: "conversation_flow",
  system_prompt: "You are a helpful assistant.",
  states: [{ id: "greeting", name: "Greeting", prompt_fragment: "Say hi.", allowed_tools: [] }],
  transitions: [],
  global_intents: [],
  tools: [],
  voice_id: "retell-Cimo",
  model: "gpt-4.1-mini",
  disclosure_line: "This call may be recorded by AI.",
};

const VOICE_TOOLS_WEBHOOK_URL = "https://example.supabase.co/functions/v1/voice-tools";
const EVENTS_WEBHOOK_URL = "https://example.supabase.co/functions/v1/voice-events";
const INBOUND_WEBHOOK_URL = "https://example.supabase.co/functions/v1/voice-inbound";

function makeSql(fixtures: Record<string, unknown[]>): SqlClient {
  return ((strings: TemplateStringsArray, ..._values: unknown[]) => {
    const text = strings.join(" ");
    for (const [key, rows] of Object.entries(fixtures)) {
      if (text.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as SqlClient;
}

interface CapturedRequest {
  url: string;
  body: unknown;
}

function makeCapturingRetellFetch(captured: CapturedRequest[]) {
  return (async (url: string, init?: RequestInit) => {
    captured.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
    if (typeof url === "string" && url.includes("/create-conversation-flow")) {
      return new Response(JSON.stringify({ conversation_flow_id: "flow_1" }), { status: 200 });
    }
    if (typeof url === "string" && url.includes("/create-agent")) {
      return new Response(JSON.stringify({ agent_id: "agent_1", version: 1 }), { status: 201 });
    }
    if (typeof url === "string" && url.includes("/get-agent/")) {
      return new Response(JSON.stringify({ agent_id: "agent_1", version: 1 }), { status: 200 });
    }
    if (typeof url === "string" && url.includes("/publish-agent-version/")) {
      return new Response(null, { status: 204 });
    }
    if (typeof url === "string" && url.includes("/create-phone-number")) {
      return new Response(JSON.stringify({ phone_number: "+15551230000" }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as unknown as ProvisionDeps["retellFetch"];
}

describe("PARITY-1: api-provision vs api-admin-provision-test-tenant compile+create+publish payloads", () => {
  it("produce byte-identical create-conversation-flow and create-agent request bodies for the same tenant/template", async () => {
    const logger = createLogger();

    // --- Real saga (`api-provision`) ---
    const realRequests: CapturedRequest[] = [];
    const realSql = makeSql({
      "from public.agent_configs": [],
      "from public.phone_numbers": [
        { id: "pn_1", e164: "+15551230000", retell_number_id: "+15551230000" },
      ],
      "select vertical from public.tenants where id": [{ vertical: "auto" }],
      "as tools_ok\n    from public.agent_templates": [],
      "select at.* from public.agent_templates": [HEALTHY_TEMPLATE_ROW],
      "insert into public.messages_outbound": [{ id: "msg_1" }],
    });
    const realDeps: ProvisionDeps = {
      retellFetch: makeCapturingRetellFetch(realRequests),
      retellApiKey: "key",
      retellInboundWebhookUrl: INBOUND_WEBHOOK_URL,
      voiceToolsWebhookUrl: VOICE_TOOLS_WEBHOOK_URL,
      eventsWebhookUrl: EVENTS_WEBHOOK_URL,
      logger,
    };
    const realResult = await runProvisioningSaga(realSql, TENANT_ID, realDeps);
    expect(realResult).toEqual({ status: "complete" });

    // --- Test-tenant path (`api-admin-provision-test-tenant`) ---
    const testRequests: CapturedRequest[] = [];
    const testSql = makeSql({
      "from public.tenants where slug": [],
      "into public.tenants": [{ id: TENANT_ID }],
      "into public.resources": [{ id: "res_1" }],
      "from public.agent_configs": [],
      "as tools_ok\n    from public.agent_templates": [],
      "select at.* from public.agent_templates": [HEALTHY_TEMPLATE_ROW],
    });
    const testDeps = {
      retellFetch: makeCapturingRetellFetch(testRequests),
      retellApiKey: "key",
      voiceToolsWebhookUrl: VOICE_TOOLS_WEBHOOK_URL,
      eventsWebhookUrl: EVENTS_WEBHOOK_URL,
      logger,
    };
    const testResult = await provisionTestTenant(
      testSql,
      {
        vertical: "auto",
        name: "Parity Fixture",
        slug: "parity-fixture",
        owner_email: "owner@example.com",
      },
      testDeps,
    );
    expect(testResult.status).toBe(200);
    expect(testResult.body).toEqual({ tenant_id: TENANT_ID, agent_id: "agent_1" });

    // --- Compare payloads ---
    const realFlowCall = realRequests.find((r) => r.url.includes("/create-conversation-flow"));
    const testFlowCall = testRequests.find((r) => r.url.includes("/create-conversation-flow"));
    expect(realFlowCall?.body).toEqual(testFlowCall?.body);

    const realAgentCall = realRequests.find((r) => r.url.includes("/create-agent"));
    const testAgentCall = testRequests.find((r) => r.url.includes("/create-agent"));
    expect(realAgentCall?.body).toEqual(testAgentCall?.body);
    // Pin the exact shape once, so a future accidental divergence (e.g. one
    // caller forgetting `webhook_url`, CALL-5's original bug) fails loudly
    // rather than only failing the cross-comparison above.
    expect(realAgentCall?.body).toEqual({
      agent_name: `heyloo-tenant-${TENANT_ID}`,
      voice_id: "retell-Cimo",
      response_engine: { type: "conversation-flow", conversation_flow_id: "flow_1" },
      webhook_url: EVENTS_WEBHOOK_URL,
      webhook_timeout_ms: 10000,
      // QA-HOT: this fixture's `makeSql` has no row for the tenant's own
      // `language_config` lookup, so it degrades to the documented
      // `"en"` default -> `resolveRetellAgentLanguage("en")` -> `"en-US"`.
      language: "en-US",
    });
  });
});
