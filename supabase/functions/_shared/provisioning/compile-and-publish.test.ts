import { describe, expect, it } from "vitest";
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
