import { type ImportPhoneNumberInput, VoiceProviderError } from "@heyloo/canonical-types";
import { describe, expect, it, vi } from "vitest";
import { RetellClient } from "./client.js";
import { importTwilioNumberIntoRetell } from "./numbers.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const BASE_INPUT: ImportPhoneNumberInput = {
  phoneNumberE164: "+15551234567",
  terminationUri: "heyloo-trunk.pstn.twilio.com",
  inboundAgentId: "agent_1",
};

describe("importTwilioNumberIntoRetell", () => {
  it("posts /import-phone-number with a single-element inbound_agents array, weight required (VERIFY-7, resolved)", async () => {
    let capturedBody: unknown;
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(new URL(url).pathname).toBe("/import-phone-number");
      capturedBody = JSON.parse(init?.body as string);
      return jsonResponse(200, { phone_number: "+15551234567" });
    });
    const client = new RetellClient({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await importTwilioNumberIntoRetell(client, BASE_INPUT);

    expect(result).toEqual({ providerPhoneNumberId: "+15551234567" });
    expect(capturedBody).toEqual({
      phone_number: "+15551234567",
      termination_uri: "heyloo-trunk.pstn.twilio.com",
      inbound_agents: [{ agent_id: "agent_1", weight: 1 }],
    });
  });

  it("lowers outboundAgentId to an outbound_agents array (not a bare id — VERIFY-7, resolved) and includes optional fields only when provided", async () => {
    let capturedBody: unknown;
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return jsonResponse(200, { phone_number: "+15551234567" });
    });
    const client = new RetellClient({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await importTwilioNumberIntoRetell(client, {
      ...BASE_INPUT,
      outboundAgentId: "agent_2",
      inboundWebhookUrl: "https://example.supabase.co/functions/v1/voice-inbound",
      sipTrunkAuthUsername: "user",
      sipTrunkAuthPassword: "pass",
    });

    expect(capturedBody).toMatchObject({
      outbound_agents: [{ agent_id: "agent_2", weight: 1 }],
      inbound_webhook_url: "https://example.supabase.co/functions/v1/voice-inbound",
      sip_trunk_auth_username: "user",
      sip_trunk_auth_password: "pass",
    });
  });

  it("throws a typed error on an unexpected response shape", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { nope: true }));
    const client = new RetellClient({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(importTwilioNumberIntoRetell(client, BASE_INPUT)).rejects.toThrow(
      VoiceProviderError,
    );
  });
});
