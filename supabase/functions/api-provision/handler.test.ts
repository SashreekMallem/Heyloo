import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import type { ProvisionDeps } from "./handler.ts";
import { republishTenantAgent, runProvisioningSaga } from "./handler.ts";

const logger = createLogger();

function makeSql(fixtures: Record<string, unknown[]> = {}): {
  sql: SqlClient;
  calls: { text: string; values: unknown[] }[];
} {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    for (const [key, rows] of Object.entries(fixtures)) {
      if (text.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

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

/** Base fixture set for a fresh tenant that reaches a full, real compile
 * through `_shared/provisioning/compile-and-publish.ts` — mirrors
 * `api-admin-provision-test-tenant/handler.test.ts`'s own fixture shape
 * (PARITY-1: both callers now exercise the exact same shared queries). */
function baseFixtures(overrides: Record<string, unknown[]> = {}): Record<string, unknown[]> {
  return {
    "from public.agent_configs": [],
    "from public.phone_numbers": [],
    "select vertical from public.tenants where id": [{ vertical: "auto" }],
    "as tools_ok\n    from public.agent_templates": [],
    "select at.* from public.agent_templates": [HEALTHY_TEMPLATE_ROW],
    "returning id, e164, retell_number_id": [
      { id: "pn_1", e164: "+15551230000", retell_number_id: "+15551230000" },
    ],
    "insert into public.messages_outbound": [{ id: "msg_1" }],
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ProvisionDeps> = {}): ProvisionDeps {
  return {
    // `version` included on every Retell response — `getAgent` (called
    // before publish, RETELL-VERIFY VERIFY-6 resolved) requires it just as
    // much as `createAgent`'s own response does. `phone_number` covers
    // `createPhoneNumber`'s response too (SIGNUP-1).
    retellFetch: (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            agent_id: "agent_1",
            conversation_flow_id: "flow_1",
            llm_id: "llm_1",
            version: 1,
            phone_number: "+15551230000",
          }),
          { status: 200 },
        ),
      )) as never,
    retellApiKey: "key",
    retellInboundWebhookUrl: "https://example.supabase.co/functions/v1/voice-inbound",
    voiceToolsWebhookUrl: "https://example.supabase.co/functions/v1/voice-tools",
    eventsWebhookUrl: "https://example.supabase.co/functions/v1/voice-events",
    logger,
    ...overrides,
  };
}

describe("runProvisioningSaga", () => {
  it("completes the full saga end-to-end on a fresh tenant", async () => {
    const { sql } = makeSql(baseFixtures());
    const result = await runProvisioningSaga(sql, "tenant_1", makeDeps());
    expect(result).toEqual({ status: "complete" });
  });

  it("sends weighted inbound_agents + inbound_webhook_url on the Retell number purchase, and {version} on publish (RETELL-VERIFY)", async () => {
    const { sql } = makeSql(baseFixtures());
    const requests: { url: string; body: unknown }[] = [];
    const deps = makeDeps({
      retellFetch: ((url: string, init?: RequestInit) => {
        requests.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              agent_id: "agent_1",
              conversation_flow_id: "flow_1",
              llm_id: "llm_1",
              version: 1,
              phone_number: "+15551230000",
            }),
            { status: 200 },
          ),
        );
      }) as never,
    });
    const result = await runProvisioningSaga(sql, "tenant_1", deps);
    expect(result).toEqual({ status: "complete" });

    const purchaseCall = requests.find((r) => r.url.includes("create-phone-number"));
    expect(purchaseCall?.body).toEqual({
      inbound_agents: [{ agent_id: "agent_1", weight: 1 }],
      inbound_webhook_url: "https://example.supabase.co/functions/v1/voice-inbound",
      nickname: "heyloo-tenant-tenant_1",
    });

    const publishCall = requests.find((r) => r.url.includes("publish-agent-version"));
    expect(publishCall?.body).toEqual({ version: 1 });
  });

  it("resumes past an already-compiled agent (idempotent step 2)", async () => {
    const { sql, calls } = makeSql(
      baseFixtures({
        "from public.agent_configs": [
          { retell_agent_id: "agent_existing", template_id: "tmpl_1", template_version: 1 },
        ],
        "from public.phone_numbers": [
          { id: "pn_1", e164: "+15551230000", retell_number_id: "+15551230000" },
        ],
      }),
    );
    const result = await runProvisioningSaga(sql, "tenant_1", makeDeps());
    expect(result).toEqual({ status: "complete" });
    // create-agent should never have been called since a retell_agent_id
    // already existed — verified indirectly by there being no
    // "insert into public.agent_configs" call (only reads).
    expect(calls.some((c) => c.text.includes("insert into public.agent_configs"))).toBe(false);
  });

  it("stops at retell_number_provision and reports the failed step when the Retell number purchase fails", async () => {
    const { sql } = makeSql(baseFixtures());
    const deps = makeDeps({
      retellFetch: ((url: string) => {
        if (typeof url === "string" && url.includes("create-phone-number")) {
          return Promise.resolve(new Response("{}", { status: 400 }));
        }
        if (typeof url === "string" && url.includes("create-conversation-flow")) {
          return Promise.resolve(
            new Response(JSON.stringify({ conversation_flow_id: "flow_1" }), { status: 200 }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ agent_id: "agent_1", version: 1 }), { status: 200 }),
        );
      }) as never,
    });
    const result = await runProvisioningSaga(sql, "tenant_1", deps);
    expect(result).toEqual({
      status: "failed",
      failedStep: "retell_number_provision",
      error: "retell_number_purchase_failed",
    });
  });

  it("hard-fails agent_compile and never calls Retell when the compiled flow is missing the disclosure line (CLAUDE.md Rule 2, G1/G2)", async () => {
    const { sql, calls } = makeSql(
      baseFixtures({
        "select at.* from public.agent_templates": [
          { ...HEALTHY_TEMPLATE_ROW, disclosure_line: "" },
        ],
      }),
    );
    const retellCalls: string[] = [];
    const deps = makeDeps({
      retellFetch: ((url: string) => {
        retellCalls.push(url);
        return Promise.resolve(
          new Response(JSON.stringify({ agent_id: "agent_1", version: 1 }), { status: 200 }),
        );
      }) as never,
    });
    const result = await runProvisioningSaga(sql, "tenant_1", deps);
    expect(result).toEqual({
      status: "failed",
      failedStep: "agent_compile",
      error: "disclosure_gate_failed",
    });
    expect(retellCalls).toEqual([]);
    const failedRun = calls.find(
      (c) =>
        c.text.includes("insert into public.provisioning_runs") &&
        c.values.includes("disclosure_gate_failed"),
    );
    expect(failedRun).toBeDefined();
  });

  it("fails agent_compile with no_active_template when the tenant's vertical has no active template", async () => {
    const { sql } = makeSql(
      baseFixtures({
        "select at.* from public.agent_templates": [],
      }),
    );
    const result = await runProvisioningSaga(sql, "tenant_1", makeDeps());
    expect(result).toEqual({
      status: "failed",
      failedStep: "agent_compile",
      error: "no_active_template_for_vertical",
    });
  });

  it("fails agent_compile with tenant_not_found when the tenant row doesn't resolve a vertical", async () => {
    const { sql } = makeSql(
      baseFixtures({
        "select vertical from public.tenants where id": [],
      }),
    );
    const result = await runProvisioningSaga(sql, "tenant_1", makeDeps());
    expect(result).toEqual({
      status: "failed",
      failedStep: "agent_compile",
      error: "tenant_not_found",
    });
  });

  it("creates the conversation-flow resource before the agent, and references it via response_engine", async () => {
    const { sql } = makeSql(baseFixtures());
    const requests: { url: string; body: unknown }[] = [];
    const deps = makeDeps({
      retellFetch: ((url: string, init?: RequestInit) => {
        requests.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
        if (url.includes("create-conversation-flow")) {
          return Promise.resolve(
            new Response(JSON.stringify({ conversation_flow_id: "flow_1" }), { status: 200 }),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({ agent_id: "agent_1", version: 1, phone_number: "+15551230000" }),
            { status: 200 },
          ),
        );
      }) as never,
    });
    const result = await runProvisioningSaga(sql, "tenant_1", deps);
    expect(result).toEqual({ status: "complete" });

    const flowCall = requests.find((r) => r.url.includes("create-conversation-flow"));
    expect((flowCall?.body as { model_choice?: unknown })?.model_choice).toEqual({
      model: "gpt-4.1-mini",
      type: "cascading",
    });

    const agentCall = requests.find((r) => r.url.includes("create-agent"));
    expect(agentCall?.body).toEqual({
      agent_name: "heyloo-tenant-tenant_1",
      voice_id: "retell-Cimo",
      response_engine: { type: "conversation-flow", conversation_flow_id: "flow_1" },
      // CALL-5 fix.
      webhook_url: "https://example.supabase.co/functions/v1/voice-events",
      webhook_timeout_ms: 10000,
    });
  });
});

describe("republishTenantAgent", () => {
  it("refuses a tenant that isn't marked is_test (never reaches a real, billable tenant)", async () => {
    const { sql } = makeSql({
      "select vertical, is_test from public.tenants": [{ vertical: "auto", is_test: false }],
    });
    const result = await republishTenantAgent(sql, "tenant_1", makeDeps());
    expect(result).toEqual({ status: 403, body: { error: "not_a_test_tenant" } });
  });

  it("404s when the tenant doesn't exist", async () => {
    const { sql } = makeSql({ "select vertical, is_test from public.tenants": [] });
    const result = await republishTenantAgent(sql, "tenant_1", makeDeps());
    expect(result).toEqual({ status: 404, body: { error: "tenant_not_found" } });
  });

  it("422s when the tenant has never been provisioned", async () => {
    const { sql } = makeSql({
      "select vertical, is_test from public.tenants": [{ vertical: "auto", is_test: true }],
      "select retell_agent_id from public.agent_configs": [],
    });
    const result = await republishTenantAgent(sql, "tenant_1", makeDeps());
    expect(result).toEqual({ status: 422, body: { error: "tenant_not_provisioned_yet" } });
  });

  it("recompiles, publishes a NEW agent, and re-points ONLY the number's inbound_agents (never outbound_agents)", async () => {
    const { sql } = makeSql(
      baseFixtures({
        "select vertical, is_test from public.tenants": [{ vertical: "auto", is_test: true }],
        // Overrides the generic base fixtures directly (rather than adding
        // more-specific keys) so ordering in the fixture lookup loop can't
        // shadow the intended row — both `select retell_agent_id from
        // public.agent_configs` and `select transfer_number from public.
        // agent_configs` match this same generic substring.
        "from public.agent_configs": [{ retell_agent_id: "agent_old" }],
        // Both `select e164 from public.phone_numbers` and the saga's own
        // number-lookup query match this same generic substring.
        "from public.phone_numbers": [{ e164: "+16105383920" }],
      }),
    );
    const requests: { url: string; init: RequestInit | undefined; body: unknown }[] = [];
    const deps = makeDeps({
      retellFetch: ((url: string, init?: RequestInit) => {
        requests.push({
          url,
          init,
          body: init?.body ? JSON.parse(init.body as string) : undefined,
        });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              agent_id: "agent_new",
              conversation_flow_id: "flow_new",
              version: 1,
            }),
            { status: 200 },
          ),
        );
      }) as never,
    });
    const result = await republishTenantAgent(sql, "tenant_1", deps);
    expect(result).toEqual({ status: 200, body: { tenant_id: "tenant_1", agent_id: "agent_new" } });

    const numberUpdate = requests.find(
      (r) => r.url.includes("update-phone-number") && r.init?.method === "PATCH",
    );
    expect(numberUpdate?.body).toEqual({
      inbound_agents: [{ agent_id: "agent_new", weight: 1 }],
      inbound_webhook_url: "https://example.supabase.co/functions/v1/voice-inbound",
    });
    // `outbound_agents` is never present in the PATCH body — a concurrent
    // SELFCALL-1 run using this same number as an outbound caller is
    // untouched (`updatePhoneNumber` is a partial PATCH).
    expect(numberUpdate?.body).not.toHaveProperty("outbound_agents");
  });
});
