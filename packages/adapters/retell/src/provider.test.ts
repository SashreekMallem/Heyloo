import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AUTO_CONVERSATION_FLOW_TEMPLATE } from "./fixtures/templates.js";
import { RETELL_CAPABILITIES, RetellProvider } from "./provider.js";

const API_KEY = "test-api-key";
const TOOL_WEBHOOK_URL = "https://example.supabase.co/functions/v1/voice-tools";

function sign(rawBody: string): string {
  const ts = Date.now();
  const digest = createHmac("sha256", API_KEY)
    .update(rawBody + String(ts), "utf8")
    .digest("hex");
  return `v=${ts},d=${digest}`;
}

function makeProvider(): RetellProvider {
  return new RetellProvider({ apiKey: API_KEY, defaultToolWebhookUrl: TOOL_WEBHOOK_URL });
}

describe("RetellProvider", () => {
  it("declares its name and capability flags", () => {
    const provider = makeProvider();
    expect(provider.name).toBe("retell");
    expect(provider.capabilities).toBe(RETELL_CAPABILITIES);
    expect(provider.capabilities.costGranularity).toBe("exact");
  });

  it("verifyWebhookSignature delegates to the shared HMAC scheme with its own apiKey bound", () => {
    const provider = makeProvider();
    const rawBody = JSON.stringify({ hello: "world" });
    const header = sign(rawBody);
    expect(provider.verifyWebhookSignature({ rawBody, signatureHeader: header })).toEqual({
      valid: true,
    });
    expect(provider.verifyWebhookSignature({ rawBody, signatureHeader: null })).toEqual({
      valid: false,
      reason: "missing_header",
    });
  });

  it("resolveInboundCall + buildInboundResponse round-trip through the provider", () => {
    const provider = makeProvider();
    const context = provider.resolveInboundCall(
      JSON.stringify({ call_id: "call_1", from_number: "+15551234567", to_number: "+15559876543" }),
    );
    expect(context.providerCallId).toBe("call_1");

    const response = provider.buildInboundResponse({
      dynamicVariables: {
        business_name: "Joe's Auto",
        assistant_name: "Ava",
        greeting_hours_context: "open",
        timezone: "America/Chicago",
        special_instructions: "",
        is_manual_mode: false,
        language: "en-US",
        disclosure_line: "This call may be recorded.",
      },
    });
    expect(response).toMatchObject({
      call_inbound: { dynamic_variables: { disclosure_line: "This call may be recorded." } },
    });
  });

  it("verifyAndParseToolCall + buildToolCallResponse round-trip through the provider", () => {
    const provider = makeProvider();
    const rawBody = JSON.stringify({
      call_id: "call_1",
      name: "lookup_customer",
      args: { phone: "+15551234567" },
    });
    const request = provider.verifyAndParseToolCall(rawBody, sign(rawBody));
    expect(request).toEqual({
      providerCallId: "call_1",
      toolName: "lookup_customer",
      args: { phone: "+15551234567" },
    });

    expect(provider.buildToolCallResponse({ result: { found: false } })).toEqual({
      result: { found: false },
    });
  });

  it("verifyAndParseCallEndedWebhook parses and normalizes costs through the provider", () => {
    const provider = makeProvider();
    const rawBody = JSON.stringify({
      event: "call_ended",
      call: {
        call_id: "call_1",
        start_timestamp: 1_757_000_000_000,
        end_timestamp: 1_757_000_010_000,
        disconnection_reason: "user_hangup",
        call_cost: {
          product_costs: [{ product: "llm", cost: 5, is_transfer_leg_cost: false }],
          combined_cost: 5,
        },
      },
    });
    const event = provider.verifyAndParseCallEndedWebhook(rawBody, sign(rawBody));
    expect(event.providerCallId).toBe("call_1");
    expect(event.costBreakdown.total_cents).toBe(5);
  });

  it("compileTemplate produces a disclosure-verified artifact for a valid fixture", () => {
    const provider = makeProvider();
    const artifact = provider.compileTemplate(AUTO_CONVERSATION_FLOW_TEMPLATE, "conversation_flow");
    expect(artifact.compileTarget).toBe("conversation_flow");
    expect(artifact.disclosureVerified).toBe(true);
  });

  it("createOrUpdateAgent orchestrates the two-step REST flow via the injected client", async () => {
    // Patch global fetch BEFORE constructing the provider: RetellProvider builds its own
    // RetellClient internally in its constructor, which captures `fetch` at that moment.
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (url: string | URL) => {
      const path = new URL(url).pathname;
      if (path === "/create-conversation-flow") {
        return new Response(JSON.stringify({ conversation_flow_id: "flow_1" }), { status: 200 });
      }
      if (path === "/create-agent") {
        return new Response(JSON.stringify({ agent_id: "agent_1", version: 1 }), { status: 200 });
      }
      throw new Error(`unexpected path ${path}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const provider = new RetellProvider({
        apiKey: API_KEY,
        defaultToolWebhookUrl: TOOL_WEBHOOK_URL,
      });
      const result = await provider.createOrUpdateAgent({
        tenantId: "tenant_1",
        template: AUTO_CONVERSATION_FLOW_TEMPLATE,
        voiceId: "11labs-Adrian",
        model: "gpt-4o-mini",
        toolWebhookUrl: TOOL_WEBHOOK_URL,
        eventsWebhookUrl: "https://example.supabase.co/functions/v1/voice-events",
      });
      expect(result).toEqual({ providerAgentId: "agent_1", providerLlmId: "flow_1", version: 1 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
