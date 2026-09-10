import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import type { CompiledTemplateResult, ProvisionDeps } from "./handler.ts";
import { runProvisioningSaga } from "./handler.ts";

function makeCompiledTemplate(
  overrides: Partial<CompiledTemplateResult> = {},
): CompiledTemplateResult {
  return {
    templateId: "tmpl_1",
    templateVersion: 1,
    voiceId: "voice_1",
    model: "gpt-4o",
    agentName: "heyloo-tenant-tenant_1",
    disclosureVerified: true,
    flow: {
      kind: "conversation_flow",
      body: {
        start_node_id: "greeting",
        start_speaker: "agent",
        nodes: [
          {
            id: "greeting",
            type: "conversation",
            name: "Greeting",
            instruction: {
              type: "prompt",
              text: "This call is recorded and handled by an AI. Hi!",
            },
            edges: [],
          },
        ],
        tools: [],
      },
    },
    ...overrides,
  };
}

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

function makeDeps(overrides: Partial<ProvisionDeps> = {}): ProvisionDeps {
  return {
    // `version` included on every Retell response — `getAgent` (called
    // before publish, RETELL-VERIFY VERIFY-6 resolved) requires it just as
    // much as `createAgent`'s own response does.
    retellFetch: (() =>
      Promise.resolve(
        new Response(JSON.stringify({ agent_id: "agent_1", llm_id: "llm_1", version: 1 }), {
          status: 200,
        }),
      )) as never,
    retellApiKey: "key",
    retellSipTerminationUri: "heyloo-trunk.pstn.twilio.com",
    retellInboundWebhookUrl: "https://example.supabase.co/functions/v1/voice-inbound",
    twilioFetch: (() =>
      Promise.resolve(
        new Response(JSON.stringify({ sid: "PN1", phone_number: "+15551230000" }), { status: 201 }),
      )) as never,
    twilioAccountSid: "AC1",
    twilioAuthToken: "token",
    compileTemplate: async () => makeCompiledTemplate(),
    resolvePhoneNumberToProvision: async () => "+15551230000",
    logger,
    ...overrides,
  };
}

describe("runProvisioningSaga", () => {
  it("completes the full saga end-to-end on a fresh tenant", async () => {
    const { sql } = makeSql({
      "from public.agent_configs": [],
      "from public.phone_numbers": [],
      "returning id, e164, twilio_sid": [{ id: "pn_1", e164: "+15551230000", twilio_sid: "PN1" }],
      "select retell_number_id": [{ retell_number_id: null }],
      "insert into public.messages_outbound": [{ id: "msg_1" }],
    });
    const result = await runProvisioningSaga(sql, "tenant_1", makeDeps());
    expect(result).toEqual({ status: "complete" });
  });

  it("sends termination_uri + weighted inbound_agents on import, and {version} on publish (RETELL-VERIFY)", async () => {
    const { sql } = makeSql({
      "from public.agent_configs": [],
      "from public.phone_numbers": [],
      "returning id, e164, twilio_sid": [{ id: "pn_1", e164: "+15551230000", twilio_sid: "PN1" }],
      "select retell_number_id": [{ retell_number_id: null }],
      "insert into public.messages_outbound": [{ id: "msg_1" }],
    });
    const requests: { url: string; body: unknown }[] = [];
    const deps = makeDeps({
      retellFetch: ((url: string, init?: RequestInit) => {
        requests.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
        return Promise.resolve(
          new Response(JSON.stringify({ agent_id: "agent_1", llm_id: "llm_1", version: 1 }), {
            status: 200,
          }),
        );
      }) as never,
    });
    const result = await runProvisioningSaga(sql, "tenant_1", deps);
    expect(result).toEqual({ status: "complete" });

    const importCall = requests.find((r) => r.url.includes("import-phone-number"));
    expect(importCall?.body).toEqual({
      phone_number: "+15551230000",
      termination_uri: "heyloo-trunk.pstn.twilio.com",
      inbound_agents: [{ agent_id: "agent_1", weight: 1 }],
      inbound_webhook_url: "https://example.supabase.co/functions/v1/voice-inbound",
    });

    const publishCall = requests.find((r) => r.url.includes("publish-agent-version"));
    expect(publishCall?.body).toEqual({ version: 1 });
  });

  it("resumes past an already-compiled agent (idempotent step 2)", async () => {
    const { sql, calls } = makeSql({
      "from public.agent_configs": [
        { retell_agent_id: "agent_existing", template_id: "tmpl_1", template_version: 1 },
      ],
      "from public.phone_numbers": [{ id: "pn_1", e164: "+15551230000", twilio_sid: "PN1" }],
      "select retell_number_id": [{ retell_number_id: "retell_num_1" }],
      "insert into public.messages_outbound": [{ id: "msg_1" }],
    });
    const result = await runProvisioningSaga(sql, "tenant_1", makeDeps());
    expect(result).toEqual({ status: "complete" });
    // create-agent should never have been called since a retell_agent_id
    // already existed — verified indirectly by there being no
    // "insert into public.agent_configs" call (only reads).
    expect(calls.some((c) => c.text.includes("insert into public.agent_configs"))).toBe(false);
  });

  it("stops at twilio_number_provision and reports the failed step when Twilio purchase fails", async () => {
    const { sql } = makeSql({ "from public.agent_configs": [], "from public.phone_numbers": [] });
    const deps = makeDeps({
      twilioFetch: (() => Promise.resolve(new Response("{}", { status: 400 }))) as never,
    });
    const result = await runProvisioningSaga(sql, "tenant_1", deps);
    expect(result).toEqual({
      status: "failed",
      failedStep: "twilio_number_provision",
      error: "twilio_purchase_failed",
    });
  });

  it("hard-fails agent_compile and never calls Retell when the compiled flow is missing the disclosure line (CLAUDE.md Rule 2, G1/G2)", async () => {
    const { sql, calls } = makeSql({
      "from public.agent_configs": [],
      "from public.phone_numbers": [],
    });
    const retellCalls: string[] = [];
    const deps = makeDeps({
      compileTemplate: async () => makeCompiledTemplate({ disclosureVerified: false }),
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
    const { sql } = makeSql({ "from public.agent_configs": [], "from public.phone_numbers": [] });
    const deps = makeDeps({ compileTemplate: async () => null });
    const result = await runProvisioningSaga(sql, "tenant_1", deps);
    expect(result).toEqual({
      status: "failed",
      failedStep: "agent_compile",
      error: "no_active_template",
    });
  });

  it("creates the conversation-flow resource before the agent, and references it via response_engine", async () => {
    const { sql } = makeSql({
      "from public.agent_configs": [],
      "from public.phone_numbers": [],
      "returning id, e164, twilio_sid": [{ id: "pn_1", e164: "+15551230000", twilio_sid: "PN1" }],
      "select retell_number_id": [{ retell_number_id: null }],
      "insert into public.messages_outbound": [{ id: "msg_1" }],
    });
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
          new Response(JSON.stringify({ agent_id: "agent_1", version: 1 }), { status: 200 }),
        );
      }) as never,
    });
    const result = await runProvisioningSaga(sql, "tenant_1", deps);
    expect(result).toEqual({ status: "complete" });

    const flowCall = requests.find((r) => r.url.includes("create-conversation-flow"));
    expect((flowCall?.body as { model_choice?: unknown })?.model_choice).toEqual({
      model: "gpt-4o",
      type: "cascading",
    });

    const agentCall = requests.find((r) => r.url.includes("create-agent"));
    expect(agentCall?.body).toEqual({
      agent_name: "heyloo-tenant-tenant_1",
      voice_id: "voice_1",
      response_engine: { type: "conversation-flow", conversation_flow_id: "flow_1" },
    });
  });

  it("flags for manual intervention (never releases the number) when Retell import fails", async () => {
    const { sql } = makeSql({
      "from public.agent_configs": [],
      "from public.phone_numbers": [{ id: "pn_1", e164: "+15551230000", twilio_sid: "PN1" }],
      "select retell_number_id": [{ retell_number_id: null }],
    });
    const deps = makeDeps({
      retellFetch: ((url: string) => {
        if (typeof url === "string" && url.includes("import-phone-number")) {
          return Promise.resolve(new Response("{}", { status: 500 }));
        }
        if (typeof url === "string" && url.includes("create-conversation-flow")) {
          return Promise.resolve(
            new Response(JSON.stringify({ conversation_flow_id: "flow_1" }), { status: 200 }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ agent_id: "agent_1" }), { status: 200 }),
        );
      }) as never,
    });
    const result = await runProvisioningSaga(sql, "tenant_1", deps);
    expect(result).toEqual({
      status: "failed",
      failedStep: "retell_number_import",
      error: "retell_import_failed",
    });
  });
});
