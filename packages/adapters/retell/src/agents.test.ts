import {
  type CreateOrUpdateAgentInput,
  DisclosureGateError,
  VoiceProviderError,
} from "@heyloo/canonical-types";
import { describe, expect, it, vi } from "vitest";
import { createOrUpdateRetellAgent, publishRetellAgentVersion } from "./agents.js";
import { RetellClient } from "./client.js";
import { compileRetellTemplate } from "./compiler/index.js";
import {
  AUTO_CONVERSATION_FLOW_TEMPLATE,
  LEGAL_MULTI_PROMPT_TEMPLATE,
} from "./fixtures/templates.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function baseInput(overrides: Partial<CreateOrUpdateAgentInput> = {}): CreateOrUpdateAgentInput {
  return {
    tenantId: "tenant_1",
    template: AUTO_CONVERSATION_FLOW_TEMPLATE,
    voiceId: "11labs-Adrian",
    model: "gpt-4o-mini",
    toolWebhookUrl: "https://example.supabase.co/functions/v1/voice-tools",
    eventsWebhookUrl: "https://example.supabase.co/functions/v1/voice-events",
    ...overrides,
  };
}

describe("createOrUpdateRetellAgent", () => {
  it("refuses to call Retell at all when the disclosure gate failed", async () => {
    const fetchImpl = vi.fn();
    const client = new RetellClient({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const input = baseInput();
    const compiled = compileRetellTemplate(
      { ...input.template, disclosure_line: "" },
      "conversation_flow",
      input.toolWebhookUrl,
    );

    await expect(createOrUpdateRetellAgent(client, input, compiled)).rejects.toThrow(
      DisclosureGateError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("creates the conversation-flow resource THEN the agent, in that order, for a conversation_flow template", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const path = new URL(url).pathname;
      calls.push(path);
      if (path === "/create-conversation-flow") {
        return jsonResponse(200, { conversation_flow_id: "flow_1" });
      }
      if (path === "/create-agent") {
        return jsonResponse(200, { agent_id: "agent_1", version: 1 });
      }
      throw new Error(`unexpected path ${path}`);
    });
    const client = new RetellClient({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const input = baseInput();
    const compiled = compileRetellTemplate(
      input.template,
      "conversation_flow",
      input.toolWebhookUrl,
    );

    const result = await createOrUpdateRetellAgent(client, input, compiled);

    expect(calls).toEqual(["/create-conversation-flow", "/create-agent"]);
    expect(result).toEqual({ providerAgentId: "agent_1", providerLlmId: "flow_1", version: 1 });
  });

  it("routes multi_prompt/single_prompt templates to /create-retell-llm", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const path = new URL(url).pathname;
      calls.push(path);
      if (path === "/create-retell-llm") return jsonResponse(200, { llm_id: "llm_1" });
      if (path === "/create-agent") return jsonResponse(200, { agent_id: "agent_2", version: 1 });
      throw new Error(`unexpected path ${path}`);
    });
    const client = new RetellClient({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const input = baseInput({ template: LEGAL_MULTI_PROMPT_TEMPLATE });
    const compiled = compileRetellTemplate(input.template, "multi_prompt", input.toolWebhookUrl);

    const result = await createOrUpdateRetellAgent(client, input, compiled);

    expect(calls).toEqual(["/create-retell-llm", "/create-agent"]);
    expect(result).toEqual({ providerAgentId: "agent_2", providerLlmId: "llm_1", version: 1 });
  });

  it("PATCHes /update-agent/{id} instead of POSTing /create-agent when existingProviderAgentId is set", async () => {
    const calls: { method: string; path: string }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const path = new URL(url).pathname;
      calls.push({ method: init?.method ?? "GET", path });
      if (path === "/create-conversation-flow")
        return jsonResponse(200, { conversation_flow_id: "flow_1" });
      return jsonResponse(200, { agent_id: "agent_1", version: 2 });
    });
    const client = new RetellClient({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const input = baseInput({ existingProviderAgentId: "agent_1" });
    const compiled = compileRetellTemplate(
      input.template,
      "conversation_flow",
      input.toolWebhookUrl,
    );

    await createOrUpdateRetellAgent(client, input, compiled);

    expect(calls).toEqual(
      expect.arrayContaining([{ method: "PATCH", path: "/update-agent/agent_1" }]),
    );
  });

  it("defaults webhook_timeout_ms to 10000 alongside webhook_url (LIVE-MINE-FIXES)", async () => {
    let agentBody: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const path = new URL(url).pathname;
      if (path === "/create-conversation-flow") {
        return jsonResponse(200, { conversation_flow_id: "flow_1" });
      }
      if (path === "/create-agent") {
        agentBody = init?.body ? JSON.parse(init.body as string) : undefined;
        return jsonResponse(200, { agent_id: "agent_1", version: 1 });
      }
      throw new Error(`unexpected path ${path}`);
    });
    const client = new RetellClient({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const input = baseInput();
    const compiled = compileRetellTemplate(
      input.template,
      "conversation_flow",
      input.toolWebhookUrl,
    );

    await createOrUpdateRetellAgent(client, input, compiled);

    expect(agentBody?.["webhook_url"]).toBe(input.eventsWebhookUrl);
    expect(agentBody?.["webhook_timeout_ms"]).toBe(10000);
  });

  it("honors an explicit webhookTimeoutMs override", async () => {
    let agentBody: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const path = new URL(url).pathname;
      if (path === "/create-conversation-flow") {
        return jsonResponse(200, { conversation_flow_id: "flow_1" });
      }
      if (path === "/create-agent") {
        agentBody = init?.body ? JSON.parse(init.body as string) : undefined;
        return jsonResponse(200, { agent_id: "agent_1", version: 1 });
      }
      throw new Error(`unexpected path ${path}`);
    });
    const client = new RetellClient({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const input = baseInput({ webhookTimeoutMs: 20000 });
    const compiled = compileRetellTemplate(
      input.template,
      "conversation_flow",
      input.toolWebhookUrl,
    );

    await createOrUpdateRetellAgent(client, input, compiled);

    expect(agentBody?.["webhook_timeout_ms"]).toBe(20000);
  });

  it("throws a typed error when the flow-resource response has neither id field", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { unexpected: true }));
    const client = new RetellClient({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const input = baseInput();
    const compiled = compileRetellTemplate(
      input.template,
      "conversation_flow",
      input.toolWebhookUrl,
    );

    await expect(createOrUpdateRetellAgent(client, input, compiled)).rejects.toThrow(
      VoiceProviderError,
    );
  });
});

describe("publishRetellAgentVersion", () => {
  it("POSTs {version} in the body and returns it, even though Retell's response body is empty (VERIFY-6, resolved)", async () => {
    let capturedBody: unknown;
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
      // Confirmed via retell-typescript-sdk: `Agent.publish` returns void —
      // Retell sends no response body at all.
      return new Response(null, { status: 204 });
    });
    const client = new RetellClient({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await publishRetellAgentVersion(client, {
      providerAgentId: "agent_1",
      version: 3,
    });
    expect(capturedBody).toEqual({ version: 3 });
    expect(result.providerAgentId).toBe("agent_1");
    expect(result.version).toBe(3);
    expect(typeof result.publishedAt).toBe("string");
  });

  it("throws a typed error when the publish request itself fails (non-2xx)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(422, { error: "invalid_version" }));
    const client = new RetellClient({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(
      publishRetellAgentVersion(client, { providerAgentId: "agent_1", version: 3 }),
    ).rejects.toThrow(VoiceProviderError);
  });
});
