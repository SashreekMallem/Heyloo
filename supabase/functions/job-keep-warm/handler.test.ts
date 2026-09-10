import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import { runKeepWarmPing } from "./handler.ts";

const logger = createLogger();
const FIXED_NOW = new Date("2026-09-10T12:00:00.000Z");

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

function makeFetch(statusByPath: Record<string, number>, calls: RecordedCall[]) {
  return (async (url: string, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers,
      body: String(init?.body ?? ""),
    });
    const path = new URL(url).pathname;
    const status = Object.entries(statusByPath).find(([p]) => path.endsWith(p))?.[1] ?? 500;
    return new Response("{}", { status });
  }) as typeof fetch;
}

describe("runKeepWarmPing", () => {
  it("pings voice-inbound and voice-tools with a valid Retell HMAC signature", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl = makeFetch({ "/voice-inbound": 404, "/voice-tools": 200 }, calls);

    const outcomes = await runKeepWarmPing({
      fetchImpl,
      supabaseUrl: "https://project.supabase.co",
      retellWebhookSigningSecret: "test-secret",
      logger,
      now: () => FIXED_NOW,
    });

    expect(outcomes).toEqual([
      { target: "voice-inbound", status: 404, ok: true },
      { target: "voice-tools", status: 200, ok: true },
    ]);
    expect(calls).toHaveLength(2);
    const [inboundCall, toolsCall] = calls as [RecordedCall, RecordedCall];
    expect(inboundCall.url).toBe("https://project.supabase.co/functions/v1/voice-inbound");
    expect(toolsCall.url).toBe("https://project.supabase.co/functions/v1/voice-tools");

    for (const call of calls) {
      expect(call.method).toBe("POST");
      const sig = call.headers["x-retell-signature"];
      expect(sig).toMatch(/^v=\d+,d=[0-9a-f]+$/);
    }
  });

  it("sends a to_number that cannot resolve to a real tenant on voice-inbound", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl = makeFetch({ "/voice-inbound": 404, "/voice-tools": 200 }, calls);

    await runKeepWarmPing({
      fetchImpl,
      supabaseUrl: "https://project.supabase.co",
      retellWebhookSigningSecret: "test-secret",
      logger,
      now: () => FIXED_NOW,
    });

    const [inboundCall] = calls as [RecordedCall];
    const body = JSON.parse(inboundCall.body);
    expect(body.call_inbound.to_number).toBe("+18005550100");
  });

  it("sends a call_id that cannot resolve to a real call context on voice-tools", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl = makeFetch({ "/voice-inbound": 404, "/voice-tools": 200 }, calls);

    await runKeepWarmPing({
      fetchImpl,
      supabaseUrl: "https://project.supabase.co",
      retellWebhookSigningSecret: "test-secret",
      logger,
      now: () => FIXED_NOW,
    });

    const [, toolsCall] = calls as [RecordedCall, RecordedCall];
    const body = JSON.parse(toolsCall.body);
    expect(body).toEqual({
      call_id: "heyloo-keep-warm-ping",
      name: "check_availability",
      args: {},
    });
  });

  it("treats voice-inbound's 200 success path as ok too (no fixed tenant should ever be provisioned for the sentinel number, but the ping is not defeated if one somehow were)", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl = makeFetch({ "/voice-inbound": 200, "/voice-tools": 200 }, calls);

    const outcomes = await runKeepWarmPing({
      fetchImpl,
      supabaseUrl: "https://project.supabase.co",
      retellWebhookSigningSecret: "test-secret",
      logger,
      now: () => FIXED_NOW,
    });

    expect(outcomes[0]).toEqual({ target: "voice-inbound", status: 200, ok: true });
  });

  it("reports a non-2xx/404 status as not ok without throwing", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl = makeFetch({ "/voice-inbound": 500, "/voice-tools": 500 }, calls);

    const outcomes = await runKeepWarmPing({
      fetchImpl,
      supabaseUrl: "https://project.supabase.co",
      retellWebhookSigningSecret: "test-secret",
      logger,
      now: () => FIXED_NOW,
    });

    expect(outcomes).toEqual([
      { target: "voice-inbound", status: 500, ok: false },
      { target: "voice-tools", status: 500, ok: false },
    ]);
  });

  it("swallows a network failure and reports it as not ok rather than throwing", async () => {
    const failingFetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    const outcomes = await runKeepWarmPing({
      fetchImpl: failingFetch,
      supabaseUrl: "https://project.supabase.co",
      retellWebhookSigningSecret: "test-secret",
      logger,
      now: () => FIXED_NOW,
    });

    expect(outcomes).toEqual([
      { target: "voice-inbound", status: 0, ok: false },
      { target: "voice-tools", status: 0, ok: false },
    ]);
  });
});
