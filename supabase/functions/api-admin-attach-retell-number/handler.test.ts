import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import { attachRetellNumber, inspectRetellConfig, validateRequest } from "./handler.ts";

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("validateRequest", () => {
  it("accepts tenant_id alone", () => {
    expect(validateRequest({ tenant_id: "t1" })).toEqual({ ok: true, data: { tenant_id: "t1" } });
  });

  it("rejects a missing tenant_id", () => {
    expect(validateRequest({})).toEqual({ ok: false, error: "invalid_tenant_id" });
  });
});

describe("attachRetellNumber", () => {
  it("returns 422 when the tenant has no compiled agent yet", async () => {
    const { sql } = makeSql({ "from public.agent_configs": [] });
    const result = await attachRetellNumber(
      sql,
      { tenant_id: "t1" },
      {
        retellFetch: async () => {
          throw new Error("should never call Retell");
        },
        retellApiKey: "key",
        inboundWebhookUrl: "https://example.com/voice-inbound",
        logger,
      },
    );
    expect(result).toEqual({ status: 422, body: { error: "tenant_has_no_agent" } });
  });

  it("picks the single account number when phone_e164 is omitted, updates it, and upserts phone_numbers", async () => {
    const { sql, calls } = makeSql({
      "from public.agent_configs": [{ retell_agent_id: "agent_1" }],
    });
    let updateBody: unknown;
    const retellFetch = async (url: string, init?: RequestInit) => {
      if (url.includes("/v2/list-phone-numbers")) {
        return jsonResponse({ items: [{ phone_number: "+14155551234" }], has_more: false });
      }
      if (url.includes("/update-phone-number/")) {
        updateBody = init?.body ? JSON.parse(init.body as string) : undefined;
        return jsonResponse({ phone_number: "+14155551234" });
      }
      throw new Error(`unexpected call: ${url}`);
    };

    const result = await attachRetellNumber(
      sql,
      { tenant_id: "t1" },
      {
        retellFetch,
        retellApiKey: "key",
        inboundWebhookUrl: "https://example.com/voice-inbound",
        logger,
      },
    );

    expect(result).toEqual({ status: 200, body: { phone_e164: "+14155551234" } });
    expect(updateBody).toEqual({
      inbound_agents: [{ agent_id: "agent_1", weight: 1 }],
      inbound_webhook_url: "https://example.com/voice-inbound",
    });
    const upsert = calls.find((c) => c.text.includes("into public.phone_numbers"));
    expect(upsert).toBeDefined();
    expect(upsert?.values).toContain("t1");
    expect(upsert?.values).toContain("+14155551234");
  });

  it("selects the requested phone_e164 when multiple numbers exist", async () => {
    const { sql } = makeSql({ "from public.agent_configs": [{ retell_agent_id: "agent_1" }] });
    const retellFetch = async (url: string) => {
      if (url.includes("/v2/list-phone-numbers")) {
        return jsonResponse({
          items: [{ phone_number: "+14155551111" }, { phone_number: "+14155552222" }],
          has_more: false,
        });
      }
      if (url.includes("/update-phone-number/")) {
        return jsonResponse({ phone_number: "+14155552222" });
      }
      throw new Error(`unexpected call: ${url}`);
    };

    const result = await attachRetellNumber(
      sql,
      { tenant_id: "t1", phone_e164: "+14155552222" },
      { retellFetch, retellApiKey: "key", inboundWebhookUrl: "https://example.com", logger },
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ phone_e164: "+14155552222" });
  });

  it("returns 422 when multiple numbers exist and phone_e164 wasn't specified", async () => {
    const { sql } = makeSql({ "from public.agent_configs": [{ retell_agent_id: "agent_1" }] });
    const retellFetch = async (url: string) => {
      if (url.includes("/v2/list-phone-numbers")) {
        return jsonResponse({
          items: [{ phone_number: "+14155551111" }, { phone_number: "+14155552222" }],
          has_more: false,
        });
      }
      throw new Error("should not reach update");
    };

    const result = await attachRetellNumber(
      sql,
      { tenant_id: "t1" },
      { retellFetch, retellApiKey: "key", inboundWebhookUrl: "https://example.com", logger },
    );

    expect(result).toEqual({
      status: 422,
      body: { error: "ambiguous_number_selection_pass_phone_e164" },
    });
  });
});

describe("inspectRetellConfig", () => {
  it("returns redacted agent + phone_number config for a fully-provisioned tenant", async () => {
    const { sql } = makeSql({
      "from public.agent_configs": [{ retell_agent_id: "agent_1" }],
      "from public.phone_numbers": [{ e164: "+14155551234" }],
    });
    const retellFetch = async (url: string) => {
      if (url.includes("/get-agent/agent_1")) {
        return jsonResponse({
          agent_id: "agent_1",
          webhook_url: "https://example.com/voice-events",
          webhook_timeout_ms: 10000,
          is_published: true,
          version: 3,
          response_engine: { type: "conversation-flow", conversation_flow_id: "flow_1" },
        });
      }
      if (url.includes("/get-conversation-flow/flow_1")) {
        return jsonResponse({
          conversation_flow_id: "flow_1",
          start_node_id: "greeting",
          nodes: [{ id: "greeting" }],
          tools: [],
          global_prompt: null,
        });
      }
      if (url.includes("/get-phone-number/")) {
        return jsonResponse({
          phone_number: "+14155551234",
          inbound_agents: [{ agent_id: "agent_1", weight: 1 }],
          inbound_webhook_url: "https://example.com/voice-inbound",
        });
      }
      throw new Error(`unexpected call: ${url}`);
    };

    const result = await inspectRetellConfig(
      sql,
      { action: "inspect", tenant_id: "t1" },
      { retellFetch, retellApiKey: "key", logger },
    );

    expect(result.status).toBe(200);
    const body = result.body as { agent: { flow_hash: string | null } };
    expect(typeof body.agent.flow_hash).toBe("string");
    expect(result).toEqual({
      status: 200,
      body: {
        agent: {
          agent_id: "agent_1",
          webhook_url: "https://example.com/voice-events",
          webhook_timeout_ms: 10000,
          is_published: true,
          version: 3,
          response_engine_type: "conversation-flow",
          flow_hash: body.agent.flow_hash,
          general_tools: null,
          language: null,
          voice_id: null,
          webhook_events: null,
          start_speaker: null,
          start_node: {
            id: "greeting",
            type: null,
            instruction_type: null,
            instruction_text: null,
          },
          begin_message: null,
        },
        phone_number: {
          phone_number: "+14155551234",
          inbound_agents: [{ agent_id: "agent_1", weight: 1 }],
          inbound_webhook_url: "https://example.com/voice-inbound",
        },
      },
    });
  });

  it("hashes the SAME flow content to the SAME flow_hash across two tenants (PARITY-1 artifact-diff use case)", async () => {
    const { sql } = makeSql({
      "from public.agent_configs": [{ retell_agent_id: "agent_a" }],
      "from public.phone_numbers": [],
    });
    const flowBody = {
      conversation_flow_id: "flow_a",
      start_node_id: "greeting",
      nodes: [{ id: "greeting", instruction: { text: "Hi, this call is recorded." } }],
      tools: [],
      global_prompt: null,
    };
    const retellFetchA = async (url: string) => {
      if (url.includes("/get-agent/agent_a")) {
        return jsonResponse({
          agent_id: "agent_a",
          is_published: true,
          version: 1,
          response_engine: { type: "conversation-flow", conversation_flow_id: "flow_a" },
        });
      }
      if (url.includes("/get-conversation-flow/flow_a")) return jsonResponse(flowBody);
      throw new Error(`unexpected call: ${url}`);
    };
    const retellFetchB = async (url: string) => {
      if (url.includes("/get-agent/agent_a")) {
        return jsonResponse({
          agent_id: "agent_a",
          is_published: true,
          version: 1,
          response_engine: { type: "conversation-flow", conversation_flow_id: "flow_b" },
        });
      }
      // A different flow_id, byte-identical CONTENT — same tenant fixture
      // reused; only the `id` differs, which the hash deliberately ignores
      // (it hashes start_node_id/nodes/tools/global_prompt, never the
      // Retell-assigned resource id itself).
      if (url.includes("/get-conversation-flow/flow_b")) {
        return jsonResponse({ ...flowBody, conversation_flow_id: "flow_b" });
      }
      throw new Error(`unexpected call: ${url}`);
    };

    const resultA = await inspectRetellConfig(
      sql,
      { tenant_id: "t1" },
      { retellFetch: retellFetchA, retellApiKey: "key", logger },
    );
    const resultB = await inspectRetellConfig(
      sql,
      { tenant_id: "t1" },
      { retellFetch: retellFetchB, retellApiKey: "key", logger },
    );
    const hashA = (resultA.body as { agent: { flow_hash: string } }).agent.flow_hash;
    const hashB = (resultB.body as { agent: { flow_hash: string } }).agent.flow_hash;
    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ANALYSIS-1: flow_hash is insensitive to intra-object KEY ORDER — live-diagnosed against signup-1-auto/test-riverside-auto, whose byte-identical compiled flows came back from Retell's own GET with the same values but different key order per node/edge", async () => {
    const { sql } = makeSql({
      "from public.agent_configs": [{ retell_agent_id: "agent_a" }],
      "from public.phone_numbers": [],
    });
    const nodeReordered = {
      edges: [
        {
          transition_condition: { prompt: "wants_to_book", type: "prompt" },
          id: "edge_1",
          destination_node_id: "booking",
        },
      ],
      id: "greeting",
      type: "conversation",
      instruction: { type: "prompt", text: "Hi, this call is recorded." },
    };
    const nodeOriginalOrder = {
      id: "greeting",
      instruction: { text: "Hi, this call is recorded.", type: "prompt" },
      edges: [
        {
          id: "edge_1",
          destination_node_id: "booking",
          transition_condition: { type: "prompt", prompt: "wants_to_book" },
        },
      ],
      type: "conversation",
    };
    const retellFetchA = async (url: string) => {
      if (url.includes("/get-agent/agent_a")) {
        return jsonResponse({
          agent_id: "agent_a",
          is_published: true,
          version: 1,
          response_engine: { type: "conversation-flow", conversation_flow_id: "flow_a" },
        });
      }
      if (url.includes("/get-conversation-flow/flow_a")) {
        return jsonResponse({
          conversation_flow_id: "flow_a",
          start_node_id: "greeting",
          nodes: [nodeOriginalOrder],
          tools: [],
          global_prompt: null,
        });
      }
      throw new Error(`unexpected call: ${url}`);
    };
    const retellFetchB = async (url: string) => {
      if (url.includes("/get-agent/agent_a")) {
        return jsonResponse({
          agent_id: "agent_a",
          is_published: true,
          version: 1,
          response_engine: { type: "conversation-flow", conversation_flow_id: "flow_b" },
        });
      }
      if (url.includes("/get-conversation-flow/flow_b")) {
        return jsonResponse({
          conversation_flow_id: "flow_b",
          start_node_id: "greeting",
          // last_modification_timestamp differs too — a real field Retell
          // adds that this hash already correctly excludes.
          last_modification_timestamp: 1_700_000_999_000,
          nodes: [nodeReordered],
          tools: [],
          global_prompt: null,
        });
      }
      throw new Error(`unexpected call: ${url}`);
    };

    const resultA = await inspectRetellConfig(
      sql,
      { tenant_id: "t1" },
      { retellFetch: retellFetchA, retellApiKey: "key", logger },
    );
    const resultB = await inspectRetellConfig(
      sql,
      { tenant_id: "t1" },
      { retellFetch: retellFetchB, retellApiKey: "key", logger },
    );
    const hashA = (resultA.body as { agent: { flow_hash: string } }).agent.flow_hash;
    const hashB = (resultB.body as { agent: { flow_hash: string } }).agent.flow_hash;
    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);
  });

  it("surfaces a null webhook_url plainly (CALL-5's own real live bug shape) rather than masking it", async () => {
    const { sql } = makeSql({
      "from public.agent_configs": [{ retell_agent_id: "agent_1" }],
      "from public.phone_numbers": [],
    });
    const retellFetch = async (url: string) => {
      if (url.includes("/get-agent/agent_1")) {
        return jsonResponse({ agent_id: "agent_1", is_published: true, version: 1 });
      }
      throw new Error(`unexpected call: ${url}`);
    };

    const result = await inspectRetellConfig(
      sql,
      { tenant_id: "t1" },
      { retellFetch, retellApiKey: "key", logger },
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      agent: {
        agent_id: "agent_1",
        webhook_url: null,
        webhook_timeout_ms: null,
        is_published: true,
        version: 1,
        response_engine_type: null,
        flow_hash: null,
        general_tools: null,
        language: null,
        voice_id: null,
        webhook_events: null,
        start_speaker: null,
        begin_message: null,
        start_node: null,
      },
      phone_number: null,
    });
  });

  it("RETELLCFG: returns the agent language, voice and the conversation flow's static opening node", async () => {
    const { sql } = makeSql({
      "from public.agent_configs": [{ retell_agent_id: "agent_es" }],
      "from public.phone_numbers": [],
    });
    const retellFetch = async (url: string) => {
      if (url.includes("/get-agent/agent_es")) {
        return jsonResponse({
          agent_id: "agent_es",
          is_published: true,
          version: 2,
          language: "es-419",
          voice_id: "11labs-Adrian",
          webhook_url: "https://example.com/voice-events",
          webhook_events: ["call_started", "call_ended", "call_analyzed"],
          response_engine: { type: "conversation-flow", conversation_flow_id: "flow_es" },
        });
      }
      if (url.includes("/get-conversation-flow/flow_es")) {
        return jsonResponse({
          conversation_flow_id: "flow_es",
          start_speaker: "agent",
          start_node_id: "__opening",
          nodes: [
            { id: "intake", type: "conversation", instruction: { type: "prompt", text: "Ask" } },
            {
              id: "__opening",
              type: "conversation",
              instruction: {
                type: "static_text",
                text: "Gracias por llamar. Soy un asistente de IA y esta llamada puede ser grabada.",
              },
            },
          ],
          tools: [],
        });
      }
      throw new Error(`unexpected call: ${url}`);
    };

    const result = await inspectRetellConfig(
      sql,
      { action: "inspect", tenant_id: "t1" },
      { retellFetch, retellApiKey: "key", logger },
    );

    const agent = (result.body as unknown as { agent: Record<string, unknown> }).agent;
    expect(agent["language"]).toBe("es-419");
    expect(agent["voice_id"]).toBe("11labs-Adrian");
    expect(agent["webhook_events"]).toEqual(["call_started", "call_ended", "call_analyzed"]);
    expect(agent["start_speaker"]).toBe("agent");
    expect(agent["begin_message"]).toBeNull();
    expect(agent["start_node"]).toEqual({
      id: "__opening",
      type: "conversation",
      instruction_type: "static_text",
      instruction_text:
        "Gracias por llamar. Soy un asistente de IA y esta llamada puede ser grabada.",
    });
  });

  it("RETELLCFG: returns a retell-llm agent's begin_message and a multilingual language array", async () => {
    const { sql } = makeSql({
      "from public.agent_configs": [{ retell_agent_id: "agent_llm" }],
      "from public.phone_numbers": [],
    });
    const retellFetch = async (url: string) => {
      if (url.includes("/get-agent/agent_llm")) {
        return jsonResponse({
          agent_id: "agent_llm",
          is_published: true,
          version: 0,
          language: ["en-US", "es-419"],
          voice_id: "retell-Cimo",
          response_engine: { type: "retell-llm", llm_id: "llm_1" },
        });
      }
      if (url.includes("/get-retell-llm/llm_1")) {
        return jsonResponse({
          llm_id: "llm_1",
          start_speaker: "agent",
          begin_message: "Thanks for calling. I'm an AI assistant and this call may be recorded.",
          general_prompt: "p",
          general_tools: [{ type: "custom", name: "lookup_customer" }],
        });
      }
      throw new Error(`unexpected call: ${url}`);
    };

    const result = await inspectRetellConfig(
      sql,
      { tenant_id: "t1" },
      { retellFetch, retellApiKey: "key", logger },
    );

    const agent = (result.body as unknown as { agent: Record<string, unknown> }).agent;
    expect(agent["language"]).toEqual(["en-US", "es-419"]);
    expect(agent["voice_id"]).toBe("retell-Cimo");
    expect(agent["start_speaker"]).toBe("agent");
    expect(agent["begin_message"]).toBe(
      "Thanks for calling. I'm an AI assistant and this call may be recorded.",
    );
    expect(agent["start_node"]).toBeNull();
    expect(agent["general_tools"]).toEqual(["lookup_customer"]);
  });

  it("returns null agent/phone_number rather than erroring when the tenant has neither yet", async () => {
    const { sql } = makeSql({
      "from public.agent_configs": [],
      "from public.phone_numbers": [],
    });
    const result = await inspectRetellConfig(
      sql,
      { tenant_id: "t1" },
      {
        retellFetch: async () => {
          throw new Error("should never call Retell");
        },
        retellApiKey: "key",
        logger,
      },
    );
    expect(result).toEqual({ status: 200, body: { agent: null, phone_number: null } });
  });

  it("rejects a missing tenant_id", async () => {
    const { sql } = makeSql();
    const result = await inspectRetellConfig(
      sql,
      {},
      {
        retellFetch: async () => {
          throw new Error("should not be called");
        },
        retellApiKey: "key",
        logger,
      },
    );
    expect(result).toEqual({ status: 422, body: { error: "invalid_tenant_id" } });
  });
});
