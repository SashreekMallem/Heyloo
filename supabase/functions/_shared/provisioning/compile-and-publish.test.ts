import { describe, expect, it } from "vitest";
import { AGENT_COMPILER_VERSION } from "../compiler/template-compiler.ts";
import { createLogger } from "../logger.ts";
import type { SqlClient } from "../types.ts";
import { type CompileAndPublishDeps, compileAndCreateAgent } from "./compile-and-publish.ts";

/**
 * QA-HOT (docs/BUILD_NOTES.md): the live half of the language fix —
 * `compile-and-publish.parity.test.ts`'s own fixture only ever exercises
 * the `"en"` default (its `makeSql` has no row for the tenant's own
 * `language_config` lookup). This proves the OTHER branch actually
 * reaches Retell: a tenant whose `tenants.language_config.primary` is
 * `"es"` gets `language: "es-419"` on the real `POST /create-agent`
 * request body — `resolveRetellAgentLanguage`'s own mapping
 * (`_shared/inbound-dynamic-variables.test.ts`), wired all the way
 * through `compileAndCreateAgent`.
 */

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

function makeSql(fixtures: Record<string, unknown[]>): SqlClient {
  return ((strings: TemplateStringsArray, ..._values: unknown[]) => {
    const text = strings.join(" ");
    for (const [key, rows] of Object.entries(fixtures)) {
      if (text.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as SqlClient;
}

function makeCapturingRetellFetch(captured: { url: string; body: unknown }[]) {
  return (async (url: string, init?: RequestInit) => {
    captured.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
    if (url.includes("/create-conversation-flow")) {
      return new Response(JSON.stringify({ conversation_flow_id: "flow_1" }), { status: 200 });
    }
    if (url.includes("/create-agent")) {
      return new Response(JSON.stringify({ agent_id: "agent_1", version: 1 }), { status: 201 });
    }
    return new Response("{}", { status: 200 });
  }) as CompileAndPublishDeps["retellFetch"];
}

describe("compileAndCreateAgent — language", () => {
  it("sends the Retell-supported es-419 locale for a tenant configured for Spanish", async () => {
    const requests: { url: string; body: unknown }[] = [];
    const sql = makeSql({
      "as tools_ok\n    from public.agent_templates": [],
      "select at.* from public.agent_templates": [HEALTHY_TEMPLATE_ROW],
      "as language_primary": [{ language_primary: "es" }],
    });
    const deps: CompileAndPublishDeps = {
      retellFetch: makeCapturingRetellFetch(requests),
      retellApiKey: "key",
      voiceToolsWebhookUrl: "https://example.supabase.co/functions/v1/voice-tools",
      eventsWebhookUrl: "https://example.supabase.co/functions/v1/voice-events",
      logger: createLogger(),
    };
    const outcome = await compileAndCreateAgent(sql, "tenant_es", "auto", deps);
    expect(outcome.ok).toBe(true);

    const agentCall = requests.find((r) => r.url.includes("/create-agent"));
    expect((agentCall?.body as { language?: string })?.language).toBe("es-419");
  });

  it("defaults to en-US when the tenant row has no language_config match", async () => {
    const requests: { url: string; body: unknown }[] = [];
    const sql = makeSql({
      "as tools_ok\n    from public.agent_templates": [],
      "select at.* from public.agent_templates": [HEALTHY_TEMPLATE_ROW],
      // No "as language_primary" fixture — falls through to `[]`, same as
      // an English-default tenant.
    });
    const deps: CompileAndPublishDeps = {
      retellFetch: makeCapturingRetellFetch(requests),
      retellApiKey: "key",
      voiceToolsWebhookUrl: "https://example.supabase.co/functions/v1/voice-tools",
      eventsWebhookUrl: "https://example.supabase.co/functions/v1/voice-events",
      logger: createLogger(),
    };
    const outcome = await compileAndCreateAgent(sql, "tenant_en", "auto", deps);
    expect(outcome.ok).toBe(true);

    const agentCall = requests.find((r) => r.url.includes("/create-agent"));
    expect((agentCall?.body as { language?: string })?.language).toBe("en-US");
  });
});

/**
 * DISCLOSE-1 (docs/BUILD_NOTES.md): what actually reaches Retell for a real
 * tenant — the compiled flow's first utterance is the static opening line
 * (disclosure verbatim, in the tenant's language), and the tenant's own
 * business/assistant names are compiled into `default_dynamic_variables` so
 * a web call that never runs `voice-inbound` never speaks a raw
 * `{{business_name}}`.
 */
const STANDARD_DISCLOSURE =
  "Thanks for calling {{business_name}}. This is {{assistant_name}}, their AI assistant — this call may be recorded.";

function deps(requests: { url: string; body: unknown }[]): CompileAndPublishDeps {
  return {
    retellFetch: makeCapturingRetellFetch(requests),
    retellApiKey: "key",
    voiceToolsWebhookUrl: "https://example.supabase.co/functions/v1/voice-tools",
    eventsWebhookUrl: "https://example.supabase.co/functions/v1/voice-events",
    logger: createLogger(),
  };
}

describe("compileAndCreateAgent — static opening line + default dynamic variables (DISCLOSE-1)", () => {
  it("sends a conversation flow whose start node speaks the disclosure verbatim, with the tenant's names as defaults", async () => {
    const requests: { url: string; body: unknown }[] = [];
    const sql = makeSql({
      "as tools_ok\n    from public.agent_templates": [],
      "select at.* from public.agent_templates": [
        { ...HEALTHY_TEMPLATE_ROW, disclosure_line: STANDARD_DISCLOSURE },
      ],
      "as language_primary": [
        { language_primary: "en", business_name: "Riverside Auto Repair", assistant_name: "Nova" },
      ],
    });
    const outcome = await compileAndCreateAgent(sql, "tenant_en", "auto", deps(requests));
    expect(outcome.ok).toBe(true);

    const flow = requests.find((r) => r.url.includes("/create-conversation-flow"))?.body as {
      start_node_id: string;
      nodes: Array<{
        id: string;
        instruction?: { type: string; text: string };
        interruption_sensitivity?: number;
      }>;
      default_dynamic_variables: Record<string, string>;
    };
    const start = flow.nodes.find((n) => n.id === flow.start_node_id);
    expect(start?.instruction).toEqual({
      type: "static_text",
      text: `${STANDARD_DISCLOSURE} {{caller_greeting}} How can I help you today?`,
    });
    // DISCLOSE-1 review: the real request body blocks interruptions on the
    // opening node only (Retell's recording-disclaimer setup).
    expect(start?.interruption_sensitivity).toBe(0);
    expect(
      flow.nodes.filter((n) => n.interruption_sensitivity !== undefined).map((n) => n.id),
    ).toEqual([flow.start_node_id]);
    expect(flow.default_dynamic_variables).toMatchObject({
      business_name: "Riverside Auto Repair",
      assistant_name: "Nova",
      caller_greeting: "",
      transfer_number: "",
      language: "en",
    });
  });

  it("a Spanish tenant's agent opens with the vetted Spanish disclosure literal and a Spanish default assistant name", async () => {
    const requests: { url: string; body: unknown }[] = [];
    const sql = makeSql({
      "as tools_ok\n    from public.agent_templates": [],
      "select at.* from public.agent_templates": [
        { ...HEALTHY_TEMPLATE_ROW, disclosure_line: STANDARD_DISCLOSURE },
      ],
      "as language_primary": [
        { language_primary: "es", business_name: "Anyservice Co", assistant_name: null },
      ],
    });
    const outcome = await compileAndCreateAgent(sql, "tenant_es", "auto", deps(requests));
    expect(outcome.ok).toBe(true);
    const flow = requests.find((r) => r.url.includes("/create-conversation-flow"))?.body as {
      start_node_id: string;
      nodes: Array<{ id: string; instruction?: { type: string; text: string } }>;
      default_dynamic_variables: Record<string, string>;
    };
    const start = flow.nodes.find((n) => n.id === flow.start_node_id);
    expect(start?.instruction?.type).toBe("static_text");
    expect(start?.instruction?.text).toContain("esta llamada puede ser grabada");
    expect(flow.default_dynamic_variables["assistant_name"]).toBe("Ava");
    expect(flow.default_dynamic_variables["language"]).toBe("es");
  });

  it("a retell-llm (multi_prompt) template sends begin_message + start_speaker agent on create-retell-llm", async () => {
    const requests: { url: string; body: unknown }[] = [];
    const sql = makeSql({
      "as tools_ok\n    from public.agent_templates": [],
      "select at.* from public.agent_templates": [
        {
          ...HEALTHY_TEMPLATE_ROW,
          compile_target: "multi_prompt",
          disclosure_line: STANDARD_DISCLOSURE,
        },
      ],
    });
    const fetchWithLlm = (async (url: string, init?: RequestInit) => {
      requests.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url.includes("/create-retell-llm")) {
        return new Response(JSON.stringify({ llm_id: "llm_1" }), { status: 201 });
      }
      if (url.includes("/create-agent")) {
        return new Response(JSON.stringify({ agent_id: "agent_1", version: 1 }), { status: 201 });
      }
      return new Response("{}", { status: 200 });
    }) as CompileAndPublishDeps["retellFetch"];
    const outcome = await compileAndCreateAgent(sql, "tenant_llm", "legal", {
      ...deps(requests),
      retellFetch: fetchWithLlm,
    });
    expect(outcome.ok).toBe(true);
    const llm = requests.find((r) => r.url.includes("/create-retell-llm"))?.body as {
      begin_message?: string;
      start_speaker?: string;
    };
    expect(llm.begin_message).toBe(
      `${STANDARD_DISCLOSURE} {{caller_greeting}} How can I help you today?`,
    );
    expect(llm.start_speaker).toBe("agent");
  });
});

describe("compileAndCreateAgent — SETTINGS-2 compiler-version stamp", () => {
  it("writes AGENT_COMPILER_VERSION to agent_configs.compiled_with_version on insert AND on the conflict-update path", async () => {
    const upserts: { text: string; values: unknown[] }[] = [];
    const fixtures: Record<string, unknown[]> = {
      "as tools_ok\n    from public.agent_templates": [],
      "select at.* from public.agent_templates": [HEALTHY_TEMPLATE_ROW],
      "as language_primary": [{ language_primary: "en" }],
    };
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("insert into public.agent_configs")) upserts.push({ text, values });
      for (const [key, rows] of Object.entries(fixtures)) {
        if (text.includes(key)) return Promise.resolve(rows);
      }
      return Promise.resolve([]);
    }) as SqlClient;
    const requests: { url: string; body: unknown }[] = [];
    const outcome = await compileAndCreateAgent(sql, "tenant_stamp", "auto", {
      retellFetch: makeCapturingRetellFetch(requests),
      retellApiKey: "key",
      voiceToolsWebhookUrl: "https://example.supabase.co/functions/v1/voice-tools",
      eventsWebhookUrl: "https://example.supabase.co/functions/v1/voice-events",
      logger: createLogger(),
    });
    expect(outcome.ok).toBe(true);
    expect(upserts).toHaveLength(1);
    const upsert = upserts[0] as { text: string; values: unknown[] };
    expect(upsert.text).toContain("compiled_with_version");
    expect(upsert.text).toContain("compiled_with_version = excluded.compiled_with_version");
    expect(upsert.values).toContain(AGENT_COMPILER_VERSION);
  });
  it("SETTINGS-2-REVIEW: a database without the stamp column (42703) still stores the agent, without the stamp", async () => {
    const upserts: string[] = [];
    const fixtures: Record<string, unknown[]> = {
      "as tools_ok\n    from public.agent_templates": [],
      "select at.* from public.agent_templates": [HEALTHY_TEMPLATE_ROW],
      "as language_primary": [{ language_primary: "en" }],
    };
    const sql = ((strings: TemplateStringsArray) => {
      const text = strings.join(" ");
      if (text.includes("insert into public.agent_configs")) {
        upserts.push(text);
        if (text.includes("compiled_with_version")) {
          return Promise.reject(
            Object.assign(new Error('column "compiled_with_version" does not exist'), {
              code: "42703",
            }),
          );
        }
      }
      for (const [key, rows] of Object.entries(fixtures)) {
        if (text.includes(key)) return Promise.resolve(rows);
      }
      return Promise.resolve([]);
    }) as SqlClient;
    const outcome = await compileAndCreateAgent(sql, "tenant_stamp", "auto", {
      retellFetch: makeCapturingRetellFetch([]),
      retellApiKey: "key",
      voiceToolsWebhookUrl: "https://example.supabase.co/functions/v1/voice-tools",
      eventsWebhookUrl: "https://example.supabase.co/functions/v1/voice-events",
      logger: createLogger(),
    });
    expect(outcome.ok).toBe(true);
    expect(upserts).toHaveLength(2);
    expect(upserts[1]).not.toContain("compiled_with_version");
  });
});
