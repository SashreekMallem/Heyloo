import { type CreateOutboundCallInput, VoiceProviderError } from "@heyloo/canonical-types";
import { describe, expect, it, vi } from "vitest";
import { RetellClient } from "./client.js";
import { createRetellOutboundCall } from "./outbound.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function baseInput(overrides: Partial<CreateOutboundCallInput> = {}): CreateOutboundCallInput {
  return {
    toNumberE164: "+15551234567",
    fromNumberE164: "+15557654321",
    providerAgentId: "agent_1",
    dynamicVariables: { disclosure_line: "This call may be recorded, this is an AI assistant." },
    consentRef: "consent_1",
    ...overrides,
  };
}

describe("createRetellOutboundCall", () => {
  it("POSTs /v2/create-phone-call with from_number/to_number/override_agent_id/dynamic variables", async () => {
    let capturedPath: string | undefined;
    let capturedBody: unknown;
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      capturedPath = new URL(url).pathname;
      capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
      return jsonResponse(200, { call_id: "call_1" });
    });
    const client = new RetellClient({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await createRetellOutboundCall(client, baseInput());

    expect(capturedPath).toBe("/v2/create-phone-call");
    expect(capturedBody).toEqual({
      from_number: "+15557654321",
      to_number: "+15551234567",
      override_agent_id: "agent_1",
      retell_llm_dynamic_variables: {
        disclosure_line: "This call may be recorded, this is an AI assistant.",
      },
      metadata: { consent_ref: "consent_1" },
    });
    expect(result).toEqual({ providerCallId: "call_1" });
  });

  it("refuses to call Retell at all when disclosure_line is missing (G1/G2, fail closed)", async () => {
    const fetchImpl = vi.fn();
    const client = new RetellClient({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const input = baseInput({
      dynamicVariables: { disclosure_line: "" },
    });

    await expect(createRetellOutboundCall(client, input)).rejects.toThrow(VoiceProviderError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws a typed VoiceProviderError when the response has no call_id", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { unexpected: true }));
    const client = new RetellClient({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(createRetellOutboundCall(client, baseInput())).rejects.toThrow(VoiceProviderError);
  });
});
