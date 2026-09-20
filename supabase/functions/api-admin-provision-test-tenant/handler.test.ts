import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import { provisionTestTenant, validateRequest } from "./handler.ts";

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
    // Default INSERT/UPDATE-shaped statements with no matching fixture
    // resolve empty, matching real postgres.js behavior for a RETURNING-less
    // statement; anything that needs an id back must have an explicit fixture.
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

describe("validateRequest", () => {
  it("accepts a well-formed body", () => {
    const result = validateRequest({
      vertical: "auto",
      name: "Riverside Auto Repair (TEST)",
      slug: "test-riverside-auto",
      owner_email: "owner@example.com",
      owner_phone_e164: "+15550001111",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an invalid vertical (e.g. the non-canonical 'auto_repair')", () => {
    const result = validateRequest({
      vertical: "auto_repair",
      name: "x",
      slug: "x",
      owner_email: "a@b.com",
    });
    expect(result).toEqual({ ok: false, error: "invalid_vertical" });
  });

  it("rejects a malformed slug", () => {
    const result = validateRequest({
      vertical: "auto",
      name: "x",
      slug: "Not A Slug!",
      owner_email: "a@b.com",
    });
    expect(result).toEqual({ ok: false, error: "invalid_slug" });
  });

  it("rejects a malformed owner_email", () => {
    const result = validateRequest({
      vertical: "auto",
      name: "x",
      slug: "x",
      owner_email: "not-an-email",
    });
    expect(result).toEqual({ ok: false, error: "invalid_owner_email" });
  });
});

describe("provisionTestTenant", () => {
  const baseBody = {
    vertical: "auto",
    name: "Riverside Auto Repair (TEST)",
    slug: "test-riverside-auto",
    owner_email: "owner@example.com",
  };

  it("returns 422 for an invalid body without touching the DB", async () => {
    const { sql, calls } = makeSql();
    const result = await provisionTestTenant(
      sql,
      { vertical: "nope" },
      {
        retellFetch: async () => {
          throw new Error("should not be called");
        },
        retellApiKey: "key",
        voiceToolsWebhookUrl: "https://example.com/voice-tools",
        eventsWebhookUrl: "https://example.com/voice-events",
        logger,
      },
    );
    expect(result.status).toBe(422);
    expect(calls.length).toBe(0);
  });

  it("creates a new tenant, seeds resources/offerings, compiles + creates the agent, and is idempotent by slug", async () => {
    const { sql, calls } = makeSql({
      "from public.tenants where slug": [],
      "into public.tenants": [{ id: "tenant_1" }],
      "into public.resources": [{ id: "res_1" }],
      "from public.agent_configs": [],
      "as tools_ok\n    from public.agent_templates": [],
      "select at.* from public.agent_templates": [HEALTHY_TEMPLATE_ROW],
    });

    let flowCreateCalled = false;
    let agentCreateCalled = false;
    let publishCalled = false;
    let agentCreateBody: Record<string, unknown> | undefined;
    const retellFetch = async (url: string, init?: RequestInit) => {
      if (url.includes("/create-conversation-flow")) {
        flowCreateCalled = true;
        return new Response(JSON.stringify({ conversation_flow_id: "flow_1" }), { status: 200 });
      }
      if (url.includes("/create-agent")) {
        agentCreateCalled = true;
        agentCreateBody = init?.body ? JSON.parse(init.body as string) : undefined;
        return new Response(JSON.stringify({ agent_id: "agent_1", version: 1 }), { status: 201 });
      }
      if (url.includes("/get-agent/")) {
        return new Response(JSON.stringify({ agent_id: "agent_1", version: 1 }), { status: 200 });
      }
      if (url.includes("/publish-agent-version/")) {
        publishCalled = true;
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected retell call: ${url}`);
    };

    const result = await provisionTestTenant(sql, baseBody, {
      retellFetch,
      retellApiKey: "key",
      voiceToolsWebhookUrl: "https://example.com/voice-tools",
      eventsWebhookUrl: "https://example.com/voice-events",
      logger,
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ tenant_id: "tenant_1", agent_id: "agent_1" });
    expect(flowCreateCalled).toBe(true);
    expect(agentCreateCalled).toBe(true);
    expect(publishCalled).toBe(true);
    // CALL-5 fix: every created agent gets a real events webhook_url (was
    // omitted entirely before — see this file's own ProvisionTestTenantDeps#
    // eventsWebhookUrl doc comment; the real live bug this regression-tests
    // against is exactly why /voice-events had never received a call).
    expect(agentCreateBody?.["webhook_url"]).toBe("https://example.com/voice-events");
    expect(agentCreateBody?.["webhook_timeout_ms"]).toBe(10000);

    const templateSeedInsert = calls.find((c) => c.text.includes("into public.agent_templates"));
    expect(templateSeedInsert).toBeDefined();
    const availabilityCalls = calls.filter((c) =>
      c.text.includes("fn_regenerate_availability_slots"),
    );
    expect(availabilityCalls.length).toBeGreaterThan(0);
  });

  it("reuses an existing, healthy tenant and agent (idempotent on slug) without recompiling or self-healing", async () => {
    const { sql, calls } = makeSql({
      "from public.tenants where slug": [
        { id: "tenant_1", vertical: "auto", business_hours_ok: true },
      ],
      "from public.agent_configs": [
        { retell_agent_id: "agent_existing", published_at: "2026-01-01T00:00:00.000Z" },
      ],
    });

    const result = await provisionTestTenant(sql, baseBody, {
      retellFetch: async () => {
        throw new Error("should never call Retell when the agent already exists");
      },
      retellApiKey: "key",
      voiceToolsWebhookUrl: "https://example.com/voice-tools",
      eventsWebhookUrl: "https://example.com/voice-events",
      logger,
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ tenant_id: "tenant_1", agent_id: "agent_existing" });
    const resourceInserts = calls.filter((c) => c.text.includes("into public.resources"));
    expect(resourceInserts.length).toBe(0);
    const businessHoursUpdate = calls.filter((c) =>
      c.text.includes("update public.tenants set business_hours"),
    );
    expect(businessHoursUpdate.length).toBe(0);
  });

  it("CALL-2: force_recompile creates a BRAND-NEW agent (new agent_id) from the recompiled template and republishes, replacing the old one — RETELL-VERIFIED live that a published agent's flow/response_engine can never be edited in place, not even via a freshly branched draft version (see this function's own docstring)", async () => {
    const { sql, calls } = makeSql({
      "from public.tenants where slug": [
        { id: "tenant_1", vertical: "auto", business_hours_ok: true },
      ],
      "from public.agent_configs": [
        { retell_agent_id: "agent_existing", published_at: "2026-01-01T00:00:00.000Z" },
      ],
      "select at.* from public.agent_templates": [HEALTHY_TEMPLATE_ROW],
    });

    let flowCreateCalled = false;
    let agentCreateCalled = false;
    let publishCalled = false;
    const retellFetch = async (url: string) => {
      if (url.includes("/create-conversation-flow")) {
        flowCreateCalled = true;
        return new Response(JSON.stringify({ conversation_flow_id: "flow_new" }), {
          status: 200,
        });
      }
      if (url.includes("/create-agent")) {
        agentCreateCalled = true;
        return new Response(JSON.stringify({ agent_id: "agent_new", version: 1 }), {
          status: 201,
        });
      }
      if (url.includes("/get-agent/")) {
        return new Response(JSON.stringify({ agent_id: "agent_new", version: 1 }), {
          status: 200,
        });
      }
      if (url.includes("/publish-agent-version/")) {
        publishCalled = true;
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected retell call: ${url}`);
    };

    const result = await provisionTestTenant(
      sql,
      { ...baseBody, force_recompile: true },
      {
        retellFetch,
        retellApiKey: "key",
        voiceToolsWebhookUrl: "https://example.com/voice-tools",
        eventsWebhookUrl: "https://example.com/voice-events",
        logger,
      },
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ tenant_id: "tenant_1", agent_id: "agent_new" });
    expect(flowCreateCalled).toBe(true);
    expect(agentCreateCalled).toBe(true);
    expect(publishCalled).toBe(true);
    const upsert = calls.find((c) => c.text.includes("insert into public.agent_configs"));
    expect(upsert?.values).toContain("agent_new");
  });

  it("CALL-2: force_recompile re-syncs agent_templates from AGENT_TEMPLATE_SEEDS even when the existing row is already healthy (tools_ok) — otherwise a seed-content fix (like this task's own create_booking.resource_id description fix) never reaches an already-seeded vertical", async () => {
    const { sql, calls } = makeSql({
      "from public.tenants where slug": [
        { id: "tenant_1", vertical: "auto", business_hours_ok: true },
      ],
      "from public.agent_configs": [
        { retell_agent_id: "agent_existing", published_at: "2026-01-01T00:00:00.000Z" },
      ],
      // Already healthy (tools_ok: true) — without force_recompile this
      // short-circuits and never re-syncs content.
      "from public.agent_templates where vertical": [{ id: "tmpl_1", tools_ok: true }],
      "select at.* from public.agent_templates": [HEALTHY_TEMPLATE_ROW],
    });

    const retellFetch = async (url: string) => {
      if (url.includes("/create-conversation-flow")) {
        return new Response(JSON.stringify({ conversation_flow_id: "flow_new" }), {
          status: 200,
        });
      }
      if (url.includes("/create-agent")) {
        return new Response(JSON.stringify({ agent_id: "agent_new", version: 1 }), {
          status: 201,
        });
      }
      if (url.includes("/get-agent/")) {
        return new Response(JSON.stringify({ agent_id: "agent_new", version: 1 }), {
          status: 200,
        });
      }
      if (url.includes("/publish-agent-version/")) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected retell call: ${url}`);
    };

    await provisionTestTenant(
      sql,
      { ...baseBody, force_recompile: true },
      {
        retellFetch,
        retellApiKey: "key",
        voiceToolsWebhookUrl: "https://example.com/voice-tools",
        eventsWebhookUrl: "https://example.com/voice-events",
        logger,
      },
    );

    const reseedUpdate = calls.find(
      (c) => c.text.includes("update public.agent_templates set") && c.text.includes("tools ="),
    );
    expect(reseedUpdate).toBeDefined();
  });

  it("CALL-2: force_recompile that fails to create a new agent logs a warning and KEEPS the old agent, rather than failing the whole request", async () => {
    const { sql } = makeSql({
      "from public.tenants where slug": [
        { id: "tenant_1", vertical: "auto", business_hours_ok: true },
      ],
      "from public.agent_configs": [
        { retell_agent_id: "agent_existing", published_at: "2026-01-01T00:00:00.000Z" },
      ],
      "select at.* from public.agent_templates": [HEALTHY_TEMPLATE_ROW],
    });

    const retellFetch = async (url: string) => {
      if (url.includes("/create-conversation-flow")) {
        return new Response(JSON.stringify({ status: "error" }), { status: 500 });
      }
      throw new Error(`unexpected retell call: ${url}`);
    };

    const result = await provisionTestTenant(
      sql,
      { ...baseBody, force_recompile: true },
      {
        retellFetch,
        retellApiKey: "key",
        voiceToolsWebhookUrl: "https://example.com/voice-tools",
        eventsWebhookUrl: "https://example.com/voice-events",
        logger,
      },
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ tenant_id: "tenant_1", agent_id: "agent_existing" });
  });

  it("CALL-7: cleanup_superseded_agent deletes the OLD agent_id (captured before the recompile) only AFTER the new agent is created and published", async () => {
    const { sql } = makeSql({
      "from public.tenants where slug": [
        { id: "tenant_1", vertical: "auto", business_hours_ok: true },
      ],
      "from public.agent_configs": [
        { retell_agent_id: "agent_existing", published_at: "2026-01-01T00:00:00.000Z" },
      ],
      "select at.* from public.agent_templates": [HEALTHY_TEMPLATE_ROW],
    });

    const callOrder: string[] = [];
    let deletedAgentId: string | undefined;
    const retellFetch = async (url: string, init?: RequestInit) => {
      if (url.includes("/create-conversation-flow")) {
        callOrder.push("create_flow");
        return new Response(JSON.stringify({ conversation_flow_id: "flow_new" }), {
          status: 200,
        });
      }
      if (url.includes("/create-agent")) {
        callOrder.push("create_agent");
        return new Response(JSON.stringify({ agent_id: "agent_new", version: 1 }), {
          status: 201,
        });
      }
      if (url.includes("/get-agent/")) {
        return new Response(JSON.stringify({ agent_id: "agent_new", version: 1 }), {
          status: 200,
        });
      }
      if (url.includes("/publish-agent-version/")) {
        callOrder.push("publish");
        return new Response(null, { status: 204 });
      }
      if (url.includes("/delete-agent/")) {
        callOrder.push("delete");
        deletedAgentId = decodeURIComponent(url.split("/delete-agent/")[1] ?? "");
        expect(init?.method).toBe("DELETE");
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected retell call: ${url}`);
    };

    const result = await provisionTestTenant(
      sql,
      { ...baseBody, force_recompile: true, cleanup_superseded_agent: true },
      {
        retellFetch,
        retellApiKey: "key",
        voiceToolsWebhookUrl: "https://example.com/voice-tools",
        eventsWebhookUrl: "https://example.com/voice-events",
        logger,
      },
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ tenant_id: "tenant_1", agent_id: "agent_new" });
    expect(deletedAgentId).toBe("agent_existing");
    // Delete only happens after the new agent is created AND published —
    // never before, so a delete failure or an earlier step's failure can
    // never leave the tenant with zero working agents.
    expect(callOrder).toEqual(["create_flow", "create_agent", "publish", "delete"]);
  });

  it("CALL-7: cleanup_superseded_agent is a no-op on a FIRST provision (no prior agent to delete, no delete-agent call made)", async () => {
    const { sql } = makeSql({
      "from public.tenants where slug": [],
      "into public.tenants": [{ id: "tenant_1" }],
      "into public.resources": [{ id: "res_1" }],
      "from public.agent_configs": [],
      "as tools_ok\n    from public.agent_templates": [],
      "select at.* from public.agent_templates": [HEALTHY_TEMPLATE_ROW],
    });

    const retellFetch = async (url: string) => {
      if (url.includes("/create-conversation-flow")) {
        return new Response(JSON.stringify({ conversation_flow_id: "flow_new" }), {
          status: 200,
        });
      }
      if (url.includes("/create-agent")) {
        return new Response(JSON.stringify({ agent_id: "agent_new", version: 1 }), {
          status: 201,
        });
      }
      if (url.includes("/get-agent/")) {
        return new Response(JSON.stringify({ agent_id: "agent_new", version: 1 }), {
          status: 200,
        });
      }
      if (url.includes("/publish-agent-version/")) {
        return new Response(null, { status: 204 });
      }
      if (url.includes("/delete-agent/")) {
        throw new Error("delete-agent should never be called on a first provision");
      }
      throw new Error(`unexpected retell call: ${url}`);
    };

    const result = await provisionTestTenant(
      sql,
      { ...baseBody, cleanup_superseded_agent: true },
      {
        retellFetch,
        retellApiKey: "key",
        voiceToolsWebhookUrl: "https://example.com/voice-tools",
        eventsWebhookUrl: "https://example.com/voice-events",
        logger,
      },
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ tenant_id: "tenant_1", agent_id: "agent_new" });
  });

  it("self-heals a tenant row with a corrupted (non-object) business_hours column", async () => {
    const { sql, calls } = makeSql({
      "from public.tenants where slug": [
        { id: "tenant_1", vertical: "auto", business_hours_ok: false },
      ],
      "from public.resources where tenant_id": [{ id: "res_1" }, { id: "res_2" }],
      "from public.agent_configs": [
        { retell_agent_id: "agent_existing", published_at: "2026-01-01T00:00:00.000Z" },
      ],
    });

    const result = await provisionTestTenant(sql, baseBody, {
      retellFetch: async () => {
        throw new Error("should never call Retell when the agent already exists");
      },
      retellApiKey: "key",
      voiceToolsWebhookUrl: "https://example.com/voice-tools",
      eventsWebhookUrl: "https://example.com/voice-events",
      logger,
    });

    expect(result.status).toBe(200);
    const businessHoursUpdate = calls.find((c) =>
      c.text.includes("update public.tenants set business_hours"),
    );
    expect(businessHoursUpdate).toBeDefined();
    const availabilityCalls = calls.filter((c) =>
      c.text.includes("fn_regenerate_availability_slots"),
    );
    expect(availabilityCalls.length).toBe(2);
  });

  it("self-heals an agent_templates row with a corrupted (non-array) tools column", async () => {
    const { sql, calls } = makeSql({
      "from public.tenants where slug": [],
      "into public.tenants": [{ id: "tenant_1" }],
      "into public.resources": [{ id: "res_1" }],
      "from public.agent_configs": [],
      "as tools_ok\n    from public.agent_templates": [{ id: "tmpl_1", tools_ok: false }],
      "select at.* from public.agent_templates": [HEALTHY_TEMPLATE_ROW],
    });

    const retellFetch = async (url: string) => {
      if (url.includes("/create-conversation-flow")) {
        return new Response(JSON.stringify({ conversation_flow_id: "flow_1" }), { status: 200 });
      }
      if (url.includes("/create-agent")) {
        return new Response(JSON.stringify({ agent_id: "agent_1", version: 1 }), { status: 201 });
      }
      if (url.includes("/get-agent/")) {
        return new Response(JSON.stringify({ agent_id: "agent_1", version: 1 }), { status: 200 });
      }
      if (url.includes("/publish-agent-version/")) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected retell call: ${url}`);
    };

    const result = await provisionTestTenant(sql, baseBody, {
      retellFetch,
      retellApiKey: "key",
      voiceToolsWebhookUrl: "https://example.com/voice-tools",
      eventsWebhookUrl: "https://example.com/voice-events",
      logger,
    });

    expect(result.status).toBe(200);
    const templateUpdate = calls.find((c) => c.text.includes("update public.agent_templates set"));
    expect(templateUpdate).toBeDefined();
    const templateInsert = calls.find((c) => c.text.includes("insert into public.agent_templates"));
    expect(templateInsert).toBeUndefined();
  });

  it("hard-fails (never calls Retell) when the seeded template's disclosure line doesn't verify", async () => {
    const badTemplateRow = { ...HEALTHY_TEMPLATE_ROW, disclosure_line: "" };
    const { sql } = makeSql({
      "from public.tenants where slug": [],
      "into public.tenants": [{ id: "tenant_1" }],
      "into public.resources": [{ id: "res_1" }],
      "from public.agent_configs": [],
      "as tools_ok\n    from public.agent_templates": [],
      "select at.* from public.agent_templates": [badTemplateRow],
    });

    const result = await provisionTestTenant(sql, baseBody, {
      retellFetch: async () => {
        throw new Error("should never be called");
      },
      retellApiKey: "key",
      voiceToolsWebhookUrl: "https://example.com/voice-tools",
      eventsWebhookUrl: "https://example.com/voice-events",
      logger,
    });

    expect(result.status).toBe(422);
    expect(result.body).toEqual({ error: "disclosure_gate_failed" });
  });
});
