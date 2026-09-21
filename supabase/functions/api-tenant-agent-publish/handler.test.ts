import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import type { PublishAgentDeps } from "./handler.ts";
import { handlePublishAgent } from "./handler.ts";

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

/** Mirrors `api-provision/handler.test.ts`'s own `baseFixtures` shape
 * (PARITY-1: both callers exercise the exact same shared compile/publish
 * queries via `compileCreateAndPublish`). */
function baseFixtures(overrides: Record<string, unknown[]> = {}): Record<string, unknown[]> {
  return {
    "select vertical from public.tenants where id": [{ vertical: "auto" }],
    "select retell_agent_id from public.agent_configs": [{ retell_agent_id: null }],
    "as tools_ok\n    from public.agent_templates": [],
    "select at.* from public.agent_templates": [HEALTHY_TEMPLATE_ROW],
    "select transfer_number from public.agent_configs": [],
    "from public.phone_numbers": [],
    "select published_at from public.agent_configs": [{ published_at: "2026-09-21T12:00:00Z" }],
    ...overrides,
  };
}

function makeDeps(overrides: Partial<PublishAgentDeps> = {}): PublishAgentDeps {
  return {
    retellFetch: (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            agent_id: "agent_new",
            conversation_flow_id: "flow_new",
            llm_id: "llm_new",
            version: 1,
          }),
          { status: 200 },
        ),
      )) as never,
    retellApiKey: "key",
    voiceToolsWebhookUrl: "https://example.supabase.co/functions/v1/voice-tools",
    eventsWebhookUrl: "https://example.supabase.co/functions/v1/voice-events",
    retellInboundWebhookUrl: "https://example.supabase.co/functions/v1/voice-inbound",
    logger,
    ...overrides,
  };
}

describe("handlePublishAgent (PUBLISH-1)", () => {
  it("404s when the tenant doesn't exist (or is soft-deleted)", async () => {
    const { sql } = makeSql({ "select vertical from public.tenants where id": [] });
    const result = await handlePublishAgent(sql, "tenant_1", makeDeps());
    expect(result).toEqual({ status: 404, body: { error: "tenant_not_found" } });
  });

  it("compiles, publishes a NEW agent, and re-points ONLY the number's inbound_agents (never outbound_agents)", async () => {
    const { sql } = makeSql(
      baseFixtures({
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
            JSON.stringify({ agent_id: "agent_new", conversation_flow_id: "flow_new", version: 1 }),
            { status: 200 },
          ),
        );
      }) as never,
    });

    const result = await handlePublishAgent(sql, "tenant_1", deps);

    expect(result).toEqual({
      status: 200,
      body: { tenant_id: "tenant_1", agent_id: "agent_new", published_at: "2026-09-21T12:00:00Z" },
    });

    const updateNumberCall = requests.find((r) => r.url.includes("/update-phone-number/"));
    expect(updateNumberCall?.body).toEqual({
      inbound_agents: [{ agent_id: "agent_new", weight: 1 }],
      inbound_webhook_url: "https://example.supabase.co/functions/v1/voice-inbound",
    });
    expect(updateNumberCall?.body).not.toHaveProperty("outbound_agents");
  });

  it("skips the number re-point when the tenant has no active phone number yet (never errors)", async () => {
    const { sql } = makeSql(baseFixtures());
    const result = await handlePublishAgent(sql, "tenant_1", makeDeps());
    expect(result.status).toBe(200);
  });

  it("cleanup_superseded_agent: deletes the OLD agent once the new one is published, never before, never a guessed id", async () => {
    const { sql } = makeSql(
      baseFixtures({
        "select retell_agent_id from public.agent_configs": [{ retell_agent_id: "agent_old" }],
      }),
    );
    const deleteCalls: string[] = [];
    const deps = makeDeps({
      retellFetch: ((url: string, init?: RequestInit) => {
        if (init?.method === "DELETE") deleteCalls.push(url);
        return Promise.resolve(
          new Response(
            JSON.stringify({ agent_id: "agent_new", conversation_flow_id: "flow_new", version: 1 }),
            { status: 200 },
          ),
        );
      }) as never,
    });

    const result = await handlePublishAgent(sql, "tenant_1", deps);

    expect(result.status).toBe(200);
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]).toContain("agent_old");
  });

  it("a failed cleanup delete never fails the publish itself (best-effort)", async () => {
    const { sql } = makeSql(
      baseFixtures({
        "select retell_agent_id from public.agent_configs": [{ retell_agent_id: "agent_old" }],
      }),
    );
    const deps = makeDeps({
      retellFetch: ((_url: string, init?: RequestInit) => {
        if (init?.method === "DELETE") return Promise.resolve(new Response("{}", { status: 500 }));
        return Promise.resolve(
          new Response(
            JSON.stringify({ agent_id: "agent_new", conversation_flow_id: "flow_new", version: 1 }),
            { status: 200 },
          ),
        );
      }) as never,
    });
    const result = await handlePublishAgent(sql, "tenant_1", deps);
    expect(result.status).toBe(200);
  });

  it("502s with the compiler's own error when the Retell flow-create call fails", async () => {
    const { sql } = makeSql(baseFixtures());
    const deps = makeDeps({
      retellFetch: (() => Promise.resolve(new Response("{}", { status: 500 }))) as never,
    });
    const result = await handlePublishAgent(sql, "tenant_1", deps);
    expect(result).toEqual({ status: 502, body: { error: "retell_flow_create_failed" } });
  });

  it("502s when the phone-number re-point call fails, after the new agent is already published", async () => {
    const { sql } = makeSql(
      baseFixtures({
        "from public.phone_numbers": [{ e164: "+16105383920" }],
      }),
    );
    const deps = makeDeps({
      retellFetch: ((_url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") return Promise.resolve(new Response("{}", { status: 500 }));
        return Promise.resolve(
          new Response(
            JSON.stringify({ agent_id: "agent_new", conversation_flow_id: "flow_new", version: 1 }),
            { status: 200 },
          ),
        );
      }) as never,
    });
    const result = await handlePublishAgent(sql, "tenant_1", deps);
    expect(result).toEqual({ status: 502, body: { error: "retell_update_phone_number_failed" } });
  });
});
