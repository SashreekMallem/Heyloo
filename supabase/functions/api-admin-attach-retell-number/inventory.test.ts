import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import { type InventoryBody, type InventoryDeps, inventoryRetellAccount } from "./inventory.ts";

const logger = createLogger();
const PROJECT_HOST = "qulcubtwqsqgqpfgvorn.supabase.co";
const BASE = `https://${PROJECT_HOST}/functions/v1`;
const EXPECTED = {
  voice_events: `${BASE}/voice-events`,
  voice_tools: `${BASE}/voice-tools`,
  voice_inbound: `${BASE}/voice-inbound`,
};
const RIVERSIDE = "b2efae9d-8309-46d6-a950-31d683616cdc";
const VET = "cad10349-475e-45fa-a02d-9c9275cd3931";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeSql(): { sql: SqlClient; texts: string[] } {
  const texts: string[] = [];
  const sql = ((strings: TemplateStringsArray) => {
    const text = strings.join(" ");
    texts.push(text);
    if (text.includes("from public.agent_configs")) {
      return Promise.resolve([
        {
          tenant_id: RIVERSIDE,
          retell_agent_id: "agent_tenant",
          retell_llm_id: null,
          slug: "test-riverside-auto",
          name: "Riverside Auto Repair (TEST)",
          vertical: "auto",
          is_test: false,
          status: "active",
          has_billing: false,
        },
        {
          tenant_id: VET,
          retell_agent_id: "agent_vet",
          retell_llm_id: null,
          slug: "test-vet-lakeside",
          name: "Lakeside Veterinary Clinic (TEST)",
          vertical: "vet",
          is_test: false,
          status: "active",
          has_billing: false,
        },
      ]);
    }
    if (text.includes("from public.platform_settings")) {
      return Promise.resolve([
        { key: "price_card_auto", value: { base_cents: 29900 } },
        {
          key: "self_call_caller_agent",
          value: { agent_id: "agent_caller", llm_id: "llm_caller", created_at: "2026-09-21" },
        },
      ]);
    }
    if (text.includes("from public.phone_numbers")) {
      return Promise.resolve([{ e164: "+12602354330", tenant_id: RIVERSIDE }]);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, texts };
}

interface FakeAccount {
  agents: Record<string, Record<string, unknown>>;
  /** Optional unpublished drafts newer than `agents[id]` (the published one). */
  drafts?: Record<string, Record<string, unknown>>;
  /** Chat-channel agents (listed by /v2/list-agents, detailed by /get-chat-agent). */
  chatAgents?: Record<string, Record<string, unknown>>;
  llms: Record<string, unknown>[];
  flows: Record<string, unknown>[];
  numbers: Record<string, unknown>[];
  versions?: Record<string, number>;
}

function liveLikeAccount(): FakeAccount {
  return {
    agents: {
      // Current tenant agent: every URL is the configured endpoint.
      agent_tenant: {
        agent_id: "agent_tenant",
        version: 0,
        is_published: true,
        webhook_url: EXPECTED.voice_events,
        language: "en-US",
        voice_id: "retell-Cimo",
        response_engine: { type: "conversation-flow", conversation_flow_id: "flow_tenant" },
      },
      // Current tenant agent whose flow has a tool pointing at a function
      // that no longer exists — must be repaired by a republish.
      agent_vet: {
        agent_id: "agent_vet",
        version: 0,
        is_published: true,
        webhook_url: EXPECTED.voice_events,
        language: "en-US",
        voice_id: "retell-Cimo",
        response_engine: { type: "conversation-flow", conversation_flow_id: "flow_vet" },
      },
      // The self-call caller agent: created without webhook_url, so its
      // call events go to the account-level webhook (the live 404 source).
      agent_caller: {
        agent_id: "agent_caller",
        version: 0,
        is_published: true,
        voice_id: "retell-Cimo",
        response_engine: { type: "retell-llm", llm_id: "llm_caller" },
      },
      // A superseded copy of the riverside agent nobody references.
      agent_old_riverside: {
        agent_id: "agent_old_riverside",
        version: 0,
        is_published: true,
        webhook_url: EXPECTED.voice_events,
        response_engine: { type: "conversation-flow", conversation_flow_id: "flow_old" },
      },
      // Legacy product agent pointing at the deleted functions.
      agent_legacy: {
        agent_id: "agent_legacy",
        version: 3,
        is_published: true,
        webhook_url: `${BASE}/retell-assistant`,
        response_engine: { type: "retell-llm", llm_id: "llm_legacy" },
      },
      agent_template: {
        agent_id: "agent_template",
        version: 0,
        is_published: true,
        response_engine: { type: "conversation-flow", conversation_flow_id: "flow_template" },
      },
    },
    llms: [
      {
        llm_id: "llm_caller",
        version: 0,
        is_published: true,
        start_speaker: "user",
        general_prompt: "You are a customer.",
      },
      {
        llm_id: "llm_legacy",
        version: 3,
        is_published: true,
        begin_message: "Hi!",
        general_tools: [
          {
            type: "custom",
            name: "book",
            url: `${BASE}/retell-tools?api_key=live_secret_value`,
            headers: { Authorization: "Bearer sk_should_never_leak" },
          },
        ],
      },
      { llm_id: "llm_orphan", version: 0, is_published: false, general_prompt: "unused" },
    ],
    flows: [
      {
        conversation_flow_id: "flow_tenant",
        version: 0,
        is_published: true,
        start_speaker: "agent",
        start_node_id: "__opening",
        nodes: [
          {
            id: "__opening",
            type: "conversation",
            instruction: {
              type: "static_text",
              text: "Thanks for calling. This call may be recorded.",
            },
          },
        ],
        tools: [{ type: "custom", name: "check_availability", url: EXPECTED.voice_tools }],
      },
      {
        conversation_flow_id: "flow_vet",
        version: 0,
        is_published: true,
        start_node_id: "greeting",
        nodes: [
          { id: "greeting", type: "conversation", instruction: { type: "prompt", text: "Greet" } },
        ],
        tools: [{ type: "custom", name: "check_availability", url: `${BASE}/voice-tools-v0` }],
      },
      {
        conversation_flow_id: "flow_old",
        version: 0,
        tools: [{ type: "custom", name: "check_availability", url: EXPECTED.voice_tools }],
      },
      { conversation_flow_id: "flow_template", version: 0, tools: [] },
    ],
    numbers: [
      {
        phone_number: "+12602354330",
        phone_number_type: "retell-twilio",
        inbound_webhook_url: EXPECTED.voice_inbound,
        inbound_agents: [{ agent_id: "agent_tenant", weight: 1 }],
        outbound_agents: null,
      },
      {
        phone_number: "+16105383920",
        phone_number_type: "retell-twilio",
        inbound_webhook_url: EXPECTED.voice_inbound,
        inbound_agents: [{ agent_id: "agent_signup", weight: 1 }],
        outbound_agents: [{ agent_id: "agent_caller", weight: 1 }],
        sip_outbound_trunk_config: { termination_uri: "x.pstn.twilio.com", auth_username: "u" },
      },
    ],
    versions: {
      agent_old_riverside: Date.UTC(2026, 8, 21, 7, 1, 0),
      agent_legacy: Date.UTC(2025, 11, 1, 12, 0, 0),
      agent_template: Date.UTC(2026, 8, 12, 9, 0, 0),
    },
  };
}

function names(): Record<string, string> {
  return {
    agent_tenant: `heyloo-tenant-${RIVERSIDE}`,
    agent_vet: `heyloo-test-tenant-${VET}`,
    agent_caller: "Heyloo Self-Call Test Caller",
    agent_old_riverside: `heyloo-tenant-${RIVERSIDE}`,
    agent_legacy: "Legacy Receptionist",
    agent_template: "heyloo-template-abc-v1",
  };
}

function makeRetell(account: FakeAccount, opts: { agentPageSize?: number } = {}) {
  const calls: { method: string; url: string }[] = [];
  const retellFetch = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    const u = new URL(url);
    const path = u.pathname;
    if (path === "/v2/list-agents") {
      if (method !== "POST") return jsonResponse({ message: "method" }, 405);
      const all = [
        ...Object.keys(account.agents).map((id) => ({
          agent_id: id,
          agent_name: names()[id] ?? null,
          channel: "voice",
          user_modified_timestamp: Date.UTC(2026, 8, 28),
        })),
        ...Object.keys(account.chatAgents ?? {}).map((id) => ({
          agent_id: id,
          agent_name: "Website chat",
          channel: "chat",
          user_modified_timestamp: Date.UTC(2026, 8, 28),
        })),
      ];
      const size = opts.agentPageSize ?? all.length;
      const start = Number(u.searchParams.get("pagination_key") ?? "0");
      const page = all.slice(start, start + size);
      const more = start + size < all.length;
      return jsonResponse({
        items: page,
        has_more: more,
        ...(more ? { pagination_key: String(start + size) } : {}),
      });
    }
    if (path === "/v2/list-phone-numbers")
      return jsonResponse({ items: account.numbers, has_more: false });
    if (path === "/v2/list-retell-llms")
      return jsonResponse({ items: account.llms, has_more: false });
    if (path === "/v2/list-conversation-flows") {
      return jsonResponse({ items: account.flows, has_more: false });
    }
    const chatMatch = /^\/get-chat-agent\/(.+)$/.exec(path);
    if (chatMatch?.[1]) {
      const chat = account.chatAgents?.[decodeURIComponent(chatMatch[1])];
      return chat ? jsonResponse(chat) : jsonResponse({ message: "not found" }, 404);
    }
    const agentMatch = /^\/get-agent\/(.+)$/.exec(path);
    if (agentMatch?.[1]) {
      const id = decodeURIComponent(agentMatch[1]);
      const version = u.searchParams.get("version");
      const published = account.agents[id];
      if (!published) return jsonResponse({ message: "not found" }, 404);
      if (version === "latest" && account.drafts?.[id]) return jsonResponse(account.drafts[id]);
      return jsonResponse(published);
    }
    const versionsMatch = /^\/list-agent-versions\/(.+)$/.exec(path);
    if (versionsMatch?.[1]) {
      const id = decodeURIComponent(versionsMatch[1]);
      const ts = account.versions?.[id];
      return jsonResponse({
        items: ts ? [{ version: 0, is_published: true, last_modification_timestamp: ts }] : [],
        has_more: false,
      });
    }
    throw new Error(`unexpected Retell call: ${method} ${url}`);
  };
  return { retellFetch, calls };
}

function deps(retellFetch: InventoryDeps["retellFetch"], extra: Partial<InventoryDeps> = {}) {
  return {
    retellFetch,
    retellApiKey: "key",
    logger,
    expected: EXPECTED,
    projectHost: PROJECT_HOST,
    sleep: async () => {},
    ...extra,
  } satisfies InventoryDeps;
}

async function run(account = liveLikeAccount(), extra: Partial<InventoryDeps> = {}) {
  const { sql } = makeSql();
  const { retellFetch, calls } = makeRetell(account);
  const result = await inventoryRetellAccount(sql, deps(retellFetch, extra));
  return { result, body: result.body as InventoryBody, calls };
}

describe("inventoryRetellAccount", () => {
  it("lists every resource with the documented methods and paths, and is read-only", async () => {
    const { result, body, calls } = await run();
    expect(result.status).toBe(200);
    expect(body.complete).toBe(true);
    expect(body.errors).toEqual([]);
    expect(body.counts).toMatchObject({
      agents: 6,
      phone_numbers: 2,
      retell_llms: 3,
      conversation_flows: 4,
    });
    expect(calls.find((c) => c.url.includes("/v2/list-agents"))?.method).toBe("POST");
    for (const c of calls) {
      if (c.url.includes("/v2/list-agents")) continue;
      expect(c.method).toBe("GET");
    }
    expect(calls.some((c) => /update|delete|create|publish/.test(c.url))).toBe(false);
  });

  it("reproduces the live 404 source: the self-call caller agent has no webhook_url, so its events use the account-level webhook", async () => {
    const { body } = await run();
    const fallback = body.findings.filter((f) => f.kind === "account_webhook_fallback");
    const caller = fallback.find((f) => f.resource_id === "agent_caller");
    expect(caller).toMatchObject({
      severity: "high",
      path: "webhook_url",
      recommended_action: "clear_account_level_webhook",
      owners: [{ kind: "platform_settings", key: "self_call_caller_agent" }],
    });
    // An unreferenced agent without webhook_url is low severity.
    expect(fallback.find((f) => f.resource_id === "agent_template")?.severity).toBe("low");
    expect(body.agents.find((a) => a.agent_id === "agent_caller")?.bound_numbers).toEqual([
      { phone_number: "+16105383920", direction: "outbound" },
    ]);
  });

  it("flags every legacy retell-assistant / retell-tools reference and never leaks header or query secrets", async () => {
    const { body } = await run();
    const legacy = body.findings.filter((f) => f.kind === "legacy_function");
    expect(legacy.map((f) => [f.resource_type, f.resource_id, f.path, f.function_name])).toEqual(
      expect.arrayContaining([
        ["agent", "agent_legacy", "webhook_url", "retell-assistant"],
        ["retell_llm", "llm_legacy", "general_tools[0].url", "retell-tools"],
      ]),
    );
    for (const f of legacy) {
      expect(f.severity).toBe("high");
      expect(f.owners).toEqual([]);
      expect(f.recommended_action).toBe("owner_cleanup_candidate");
    }
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("sk_should_never_leak");
    expect(serialized).not.toContain("live_secret_value");
    expect(serialized).toContain(`${BASE}/retell-tools?api_key=REDACTED`);
  });

  it("marks a stale URL on a CURRENT tenant's flow for republish, naming the tenant", async () => {
    const { body } = await run();
    const stale = body.findings.find((f) => f.resource_id === "flow_vet");
    expect(stale).toMatchObject({
      kind: "unexpected_project_function",
      resource_type: "conversation_flow",
      path: "tools[0].url",
      function_name: "voice-tools-v0",
      recommended_action: "republish_tenant_agent",
    });
    expect(stale?.owners).toEqual([
      expect.objectContaining({
        kind: "agent_configs",
        tenant_id: VET,
        tenant_slug: "test-vet-lakeside",
      }),
    ]);
    // The healthy tenant has no findings at all.
    expect(
      body.findings.filter((f) =>
        ["agent_tenant", "flow_tenant", "+12602354330"].includes(f.resource_id),
      ),
    ).toEqual([]);
  });

  it("marks a tenant number whose inbound webhook still points at a legacy function for re-attach", async () => {
    const account = liveLikeAccount();
    const riverside = account.numbers[0] as Record<string, unknown>;
    riverside["inbound_webhook_url"] = `${BASE}/retell-assistant`;
    const { body } = await run(account);
    expect(body.findings.find((f) => f.resource_id === "+12602354330")).toMatchObject({
      kind: "legacy_function",
      resource_type: "phone_number",
      path: "inbound_webhook_url",
      recommended_action: "reattach_tenant_number",
      owners: [expect.objectContaining({ tenant_id: RIVERSIDE })],
    });
  });

  it("reports language, voice and the opening of each engine", async () => {
    const { body } = await run();
    const tenant = body.agents.find((a) => a.agent_id === "agent_tenant");
    expect(tenant).toMatchObject({
      language: "en-US",
      voice_id: "retell-Cimo",
      webhook_url: EXPECTED.voice_events,
      response_engine: { type: "conversation-flow", id: "flow_tenant" },
      referenced_by: [expect.objectContaining({ tenant_slug: "test-riverside-auto" })],
      bound_numbers: [{ phone_number: "+12602354330", direction: "inbound" }],
    });
    expect(body.conversation_flows.find((f) => f.id === "flow_tenant")?.start_node).toEqual({
      id: "__opening",
      type: "conversation",
      instruction_type: "static_text",
      instruction_text: "Thanks for calling. This call may be recorded.",
    });
    expect(body.retell_llms.find((l) => l.id === "llm_legacy")?.begin_message).toBe("Hi!");
    expect(body.retell_llms.find((l) => l.id === "llm_caller")).toMatchObject({
      start_speaker: "user",
      referenced_by: [{ kind: "platform_settings", key: "self_call_caller_agent" }],
      used_by_agents: ["agent_caller"],
    });
  });

  it("builds the unreferenced-agent cleanup list, oldest first, with categories and approximate creation time", async () => {
    const { body } = await run();
    expect(
      body.unreferenced_agents.map((a) => [a.agent_id, a.category, a.created_at_approx]),
    ).toEqual([
      ["agent_legacy", "unrecognized", "2025-12-01T12:00:00.000Z"],
      ["agent_template", "template_publish_agent", "2026-09-12T09:00:00.000Z"],
      ["agent_old_riverside", "superseded_tenant_agent", "2026-09-21T07:01:00.000Z"],
    ]);
    // Referenced agents (tenants + platform_settings) are never in the list.
    const listed = body.unreferenced_agents.map((a) => a.agent_id);
    for (const id of ["agent_tenant", "agent_vet", "agent_caller"])
      expect(listed).not.toContain(id);
    expect(body.orphan_retell_llm_ids).toEqual(["llm_orphan"]);
    expect(body.orphan_conversation_flow_ids).toEqual([]);
  });

  it("follows list-agents pagination", async () => {
    const { sql } = makeSql();
    const { retellFetch, calls } = makeRetell(liveLikeAccount(), { agentPageSize: 2 });
    const result = await inventoryRetellAccount(sql, deps(retellFetch));
    const body = result.body as InventoryBody;
    expect(body.counts.agents).toBe(6);
    expect(calls.filter((c) => c.url.includes("/v2/list-agents")).length).toBe(3);
    expect(calls.some((c) => c.url.includes("pagination_key=2"))).toBe(true);
  });

  it("reports the PUBLISHED version's settings when the latest is an unpublished draft, and scans the draft too", async () => {
    const account = liveLikeAccount();
    account.drafts = {
      agent_tenant: {
        agent_id: "agent_tenant",
        version: 1,
        is_published: false,
        webhook_url: `${BASE}/retell-assistant`,
        language: "es-419",
        response_engine: { type: "conversation-flow", conversation_flow_id: "flow_tenant" },
      },
    };
    const { body } = await run(account);
    const tenant = body.agents.find((a) => a.agent_id === "agent_tenant");
    expect(tenant).toMatchObject({
      version: 0,
      is_published: true,
      draft_version: 1,
      webhook_url: EXPECTED.voice_events,
      language: "en-US",
    });
    expect(
      body.findings.find((f) => f.resource_id === "agent_tenant" && f.kind === "legacy_function"),
    ).toMatchObject({ recommended_action: "republish_tenant_agent" });
  });

  it("reads a chat-channel agent through /get-chat-agent and scans its webhook_url", async () => {
    const account = liveLikeAccount();
    account.chatAgents = {
      agent_chat: {
        agent_id: "agent_chat",
        version: 0,
        is_published: true,
        webhook_url: `${BASE}/retell-events`,
        response_engine: { type: "retell-llm", llm_id: "llm_orphan" },
      },
    };
    const { body, calls } = await run(account);
    expect(calls.some((c) => c.url.includes("/get-chat-agent/agent_chat"))).toBe(true);
    expect(calls.some((c) => c.url.includes("/get-agent/agent_chat"))).toBe(false);
    expect(body.findings.find((f) => f.resource_id === "agent_chat")).toMatchObject({
      kind: "legacy_function",
      function_name: "retell-events",
    });
    expect(body.agents.find((a) => a.agent_id === "agent_chat")?.channel).toBe("chat");
    expect(body.complete).toBe(true);
  });

  it("retries a 429 and then succeeds", async () => {
    const account = liveLikeAccount();
    const { retellFetch } = makeRetell(account);
    let throttled = 0;
    const flaky = async (url: string, init?: RequestInit) => {
      if (url.includes("/v2/list-retell-llms") && throttled < 1) {
        throttled++;
        return jsonResponse({ message: "rate limited" }, 429);
      }
      return retellFetch(url, init);
    };
    const { sql } = makeSql();
    const result = await inventoryRetellAccount(sql, deps(flaky));
    expect(throttled).toBe(1);
    expect((result.body as InventoryBody).complete).toBe(true);
    expect((result.body as InventoryBody).counts.retell_llms).toBe(3);
  });

  it("returns a partial, explicitly incomplete result when a list fails or has an unexpected shape", async () => {
    const account = liveLikeAccount();
    const { retellFetch } = makeRetell(account);
    const broken = async (url: string, init?: RequestInit) => {
      if (url.includes("/v2/list-conversation-flows"))
        return jsonResponse([{ not: "an envelope" }]);
      return retellFetch(url, init);
    };
    const { sql } = makeSql();
    const body = (await inventoryRetellAccount(sql, deps(broken))).body as InventoryBody;
    expect(body.complete).toBe(false);
    expect(body.errors).toContainEqual({
      step: "list_conversation_flows",
      status: 200,
      detail: "unexpected_response_shape",
    });
    expect(body.counts.agents).toBe(6);
  });

  it("stops issuing Retell calls once the time budget is spent and says so", async () => {
    let clock = 0;
    const { sql } = makeSql();
    const { retellFetch, calls } = makeRetell(liveLikeAccount());
    const slow = async (url: string, init?: RequestInit) => {
      clock += 40;
      return retellFetch(url, init);
    };
    const result = await inventoryRetellAccount(
      sql,
      deps(slow, { now: () => clock, budgetMs: 150, concurrency: 1 }),
    );
    const body = result.body as InventoryBody;
    expect(result.status).toBe(200);
    expect(body.complete).toBe(false);
    expect(
      body.errors.some(
        (e) => e.detail === "skipped_budget_exhausted" || e.detail === "budget_exhausted",
      ),
    ).toBe(true);
    expect(calls.length).toBeLessThan(10);
  });
  describe("RETELLCFG-REVIEW", () => {
    it("treats an agent referenced only by a deployment secret (DEMO_AGENT_ID) as live, never as a cleanup candidate", async () => {
      const account = liveLikeAccount();
      account.agents["agent_demo"] = {
        agent_id: "agent_demo",
        version: 0,
        is_published: true,
        webhook_url: null,
        response_engine: { type: "retell-llm", llm_id: "llm_orphan" },
      };
      const { body } = await run(account, {
        envReferences: { DEMO_AGENT_ID: "agent_demo", UNSET_ONE: undefined, EMPTY: "  " },
      });
      expect(body.unreferenced_agents.map((a) => a.agent_id)).not.toContain("agent_demo");
      expect(body.agents.find((a) => a.agent_id === "agent_demo")?.referenced_by).toEqual([
        { kind: "env", name: "DEMO_AGENT_ID" },
      ]);
      // Its account-level fallback is an OWNED (high) finding, with the secret as owner.
      expect(
        body.findings.find(
          (f) => f.resource_id === "agent_demo" && f.kind === "account_webhook_fallback",
        ),
      ).toMatchObject({ severity: "high", owners: [{ kind: "env", name: "DEMO_AGENT_ID" }] });
      // Without the secret it would have been listed for deletion.
      const without = await run(account);
      expect(without.body.unreferenced_agents.map((a) => a.agent_id)).toContain("agent_demo");
    });

    it("redacts every URL it returns, including agent webhook_url, number webhook fields, capability-style paths and URLs inside the opening text", async () => {
      const account = liveLikeAccount();
      (account.agents["agent_legacy"] as Record<string, unknown>)["webhook_url"] =
        "https://ops:hunter2@hooks.example.com/retell?token=tok_live_123";
      const signup = account.numbers[1] as Record<string, unknown>;
      signup["inbound_sms_webhook_url"] =
        "https://acme.app.n8n.cloud/webhook/8f14e45f-ceea-467a-9575-6b2e1c3a9d0f";
      const flow = account.flows[0] as Record<string, unknown>;
      flow["nodes"] = [
        {
          id: "__opening",
          type: "conversation",
          instruction: {
            type: "static_text",
            text: "Thanks for calling. This call may be recorded. Book at https://book.example.com/s?k=sess_secret_9.",
          },
        },
      ];
      const { body } = await run(account);
      const serialized = JSON.stringify(body);
      for (const secret of [
        "hunter2",
        "tok_live_123",
        "8f14e45f-ceea-467a-9575-6b2e1c3a9d0f",
        "sess_secret_9",
      ]) {
        expect(serialized).not.toContain(secret);
      }
      expect(body.agents.find((a) => a.agent_id === "agent_legacy")?.webhook_url).toBe(
        "https://REDACTED@hooks.example.com/retell?token=REDACTED",
      );
      expect(body.unreferenced_agents.find((a) => a.agent_id === "agent_legacy")?.webhook_url).toBe(
        "https://REDACTED@hooks.example.com/retell?token=REDACTED",
      );
      expect(
        body.phone_numbers.find((n) => n.phone_number === "+16105383920")?.inbound_sms_webhook_url,
      ).toBe("https://acme.app.n8n.cloud/webhook/REDACTED");
      // The disclosure text itself is untouched.
      expect(
        body.conversation_flows.find((f) => f.id === "flow_tenant")?.start_node?.instruction_text,
      ).toBe(
        "Thanks for calling. This call may be recorded. Book at https://book.example.com/s?k=REDACTED.",
      );
    });

    it("aborts a hung Retell request after the per-request timeout and returns an explicit partial result", async () => {
      const { retellFetch } = makeRetell(liveLikeAccount());
      let hung = 0;
      const hanging = async (url: string, init?: RequestInit) => {
        if (url.includes("/v2/list-retell-llms")) {
          hung++;
          return new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          });
        }
        return retellFetch(url, init);
      };
      const { sql } = makeSql();
      const result = await inventoryRetellAccount(sql, deps(hanging, { requestTimeoutMs: 20 }));
      const body = result.body as InventoryBody;
      expect(result.status).toBe(200);
      expect(hung).toBe(3); // first attempt + 2 retries, each aborted
      expect(body.complete).toBe(false);
      expect(body.errors).toContainEqual({
        step: "list_retell_llms",
        status: 0,
        detail: "retell_error",
      });
      // The rest of the account is still inventoried.
      expect(body.counts.agents).toBe(6);
      expect(body.counts.conversation_flows).toBe(4);
      // LLM listing is not needed to trust the cleanup list.
      expect(body.cleanup_list_complete).toBe(true);
    });

    it("never offers an agent that still answers a TENANT's number for deletion, and flags the mis-bound number for re-attach", async () => {
      const account = liveLikeAccount();
      // Missed re-attach: riverside's number still rings the superseded agent.
      (account.numbers[0] as Record<string, unknown>)["inbound_agents"] = [
        { agent_id: "agent_old_riverside", weight: 1 },
      ];
      const { body } = await run(account);
      expect(body.findings.find((f) => f.kind === "tenant_number_agent_mismatch")).toMatchObject({
        severity: "high",
        resource_type: "phone_number",
        resource_id: "+12602354330",
        path: "inbound_agents",
        recommended_action: "reattach_tenant_number",
        owners: [expect.objectContaining({ tenant_id: RIVERSIDE })],
      });
      expect(
        body.unreferenced_agents.find((a) => a.agent_id === "agent_old_riverside"),
      ).toMatchObject({
        delete_hold: "bound_to_tenant_number",
        bound_numbers: [{ phone_number: "+12602354330", direction: "inbound" }],
      });
      // The correctly bound live account has no mismatch.
      const healthy = await run();
      expect(healthy.body.findings.some((f) => f.kind === "tenant_number_agent_mismatch")).toBe(
        false,
      );
    });

    it("counts SMS bindings as bindings (inbound_sms_agents / outbound_sms_agents)", async () => {
      const account = liveLikeAccount();
      (account.numbers[1] as Record<string, unknown>)["inbound_sms_agents"] = [
        { agent_id: "agent_legacy", weight: 1 },
      ];
      const { body } = await run(account);
      expect(body.unreferenced_agents.find((a) => a.agent_id === "agent_legacy")).toMatchObject({
        bound_numbers: [{ phone_number: "+16105383920", direction: "inbound_sms" }],
        delete_hold: "bound_to_number",
      });
      expect(
        body.unreferenced_agents.find((a) => a.agent_id === "agent_template")?.delete_hold,
      ).toBeNull();
    });

    it("holds the whole cleanup list when the phone-number listing is partial", async () => {
      const { retellFetch } = makeRetell(liveLikeAccount());
      const broken = async (url: string, init?: RequestInit) =>
        url.includes("/v2/list-phone-numbers")
          ? jsonResponse({ message: "boom" }, 500)
          : retellFetch(url, init);
      const { sql } = makeSql();
      const body = (await inventoryRetellAccount(sql, deps(broken))).body as InventoryBody;
      expect(body.complete).toBe(false);
      expect(body.cleanup_list_complete).toBe(false);
      expect(body.unreferenced_agents.length).toBeGreaterThan(0);
      for (const a of body.unreferenced_agents) expect(a.delete_hold).toBe("inventory_incomplete");
    });

    it("carries each tenant's billing state so a real test-* slug is never treated as a test tenant", async () => {
      const { body } = await run();
      const owner = body.agents.find((a) => a.agent_id === "agent_tenant")?.referenced_by[0];
      expect(owner).toMatchObject({ kind: "agent_configs", tenant_has_billing: false });
    });
  });
});
