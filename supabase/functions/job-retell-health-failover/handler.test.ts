import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import { runHealthCheckCycle } from "./handler.ts";

const logger = createLogger();
const ORIGINAL_VOICE_URL = "https://api.retellai.com/twilio-voice-webhook/agent_1";

function makeSql(settingsStore: Map<string, unknown>): SqlClient {
  return ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    if (text.includes("select value from public.platform_settings")) {
      const key = values[0] as string;
      const value = settingsStore.get(key);
      return Promise.resolve(value !== undefined ? [{ value }] : []);
    }
    if (text.includes("insert into public.platform_settings")) {
      const key = values[0] as string;
      const value = JSON.parse(values[1] as string);
      settingsStore.set(key, value);
      return Promise.resolve([]);
    }
    if (text.includes("from public.phone_numbers")) {
      return Promise.resolve([{ twilio_sid: "PN1", tenant_id: "t1" }]);
    }
    return Promise.resolve([]);
  }) as SqlClient;
}

interface TwilioCall {
  method: string;
  url: string;
}

function makeTwilioFetch(calls: TwilioCall[]) {
  return (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    if (method === "GET") {
      return new Response(JSON.stringify({ voice_url: ORIGINAL_VOICE_URL }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as never;
}

function makeDeps(healthy: boolean, twilioCalls: TwilioCall[] = []) {
  return {
    retellFetch: (() =>
      healthy
        ? Promise.resolve(new Response("{}", { status: 200 }))
        : Promise.reject(new Error("down"))) as never,
    retellApiKey: "key",
    twilioFetch: makeTwilioFetch(twilioCalls),
    twilioAccountSid: "AC1",
    twilioAuthToken: "token",
    failoverVoiceUrl: "https://heyloo.example.com/failover-twiml",
    logger,
  };
}

describe("runHealthCheckCycle", () => {
  it("reports healthy_no_change when Retell is up and no incident is active", async () => {
    const outcome = await runHealthCheckCycle(makeSql(new Map()), makeDeps(true));
    expect(outcome).toBe("healthy_no_change");
  });

  it("does not trigger failover before the consecutive-failure threshold", async () => {
    const store = new Map<string, unknown>();
    const deps = makeDeps(false);
    expect(await runHealthCheckCycle(makeSql(store), deps)).toBe("failure_below_threshold");
    expect(await runHealthCheckCycle(makeSql(store), deps)).toBe("failure_below_threshold");
  });

  it("triggers failover on the 3rd consecutive failure, snapshotting each number's prior VoiceUrl", async () => {
    const store = new Map<string, unknown>();
    const calls: TwilioCall[] = [];
    const deps = makeDeps(false, calls);
    await runHealthCheckCycle(makeSql(store), deps);
    await runHealthCheckCycle(makeSql(store), deps);
    const outcome = await runHealthCheckCycle(makeSql(store), deps);
    expect(outcome).toBe("failover_triggered");
    expect(store.get("platform_incident_retell_outage")).toEqual({ active: true });
    expect(store.get("retell_health_failover_voice_url_snapshot")).toEqual({
      PN1: ORIGINAL_VOICE_URL,
    });
    // Snapshot the current VoiceUrl (GET) before overwriting it (POST) —
    // never blind-overwrite without capturing what it was.
    expect(calls).toEqual([
      { method: "GET", url: expect.stringContaining("/IncomingPhoneNumbers/PN1.json") },
      { method: "POST", url: expect.stringContaining("/IncomingPhoneNumbers/PN1.json") },
    ]);
  });

  it("stays in still_incident_no_change while an incident is already active and Retell is still down", async () => {
    const store = new Map<string, unknown>([["platform_incident_retell_outage", { active: true }]]);
    const outcome = await runHealthCheckCycle(makeSql(store), makeDeps(false));
    expect(outcome).toBe("still_incident_no_change");
  });

  it("restores the exact pre-failover VoiceUrl on recovery and clears the incident flag + snapshot", async () => {
    const store = new Map<string, unknown>([
      ["platform_incident_retell_outage", { active: true }],
      ["retell_health_consecutive_failures", { count: 5 }],
      ["retell_health_failover_voice_url_snapshot", { PN1: ORIGINAL_VOICE_URL }],
    ]);
    const calls: TwilioCall[] = [];
    const outcome = await runHealthCheckCycle(makeSql(store), makeDeps(true, calls));
    expect(outcome).toBe("recovery_restored");
    expect(store.get("platform_incident_retell_outage")).toEqual({ active: false });
    expect(store.get("retell_health_consecutive_failures")).toEqual({ count: 0 });
    // Idempotency: the restored number is removed from the snapshot so a
    // repeat recovery cycle finds nothing left to restore for it.
    expect(store.get("retell_health_failover_voice_url_snapshot")).toEqual({});
    expect(calls).toEqual([
      { method: "POST", url: expect.stringContaining("/IncomingPhoneNumbers/PN1.json") },
    ]);
  });

  it("skips a number with no captured snapshot rather than guessing a VoiceUrl to restore", async () => {
    const store = new Map<string, unknown>([
      ["platform_incident_retell_outage", { active: true }],
      ["retell_health_failover_voice_url_snapshot", {}],
    ]);
    const calls: TwilioCall[] = [];
    const outcome = await runHealthCheckCycle(makeSql(store), makeDeps(true, calls));
    expect(outcome).toBe("recovery_restored");
    expect(calls).toEqual([]);
  });

  it("keeps a number in the snapshot for retry when its restore Twilio call fails", async () => {
    const store = new Map<string, unknown>([
      ["platform_incident_retell_outage", { active: true }],
      ["retell_health_failover_voice_url_snapshot", { PN1: ORIGINAL_VOICE_URL }],
    ]);
    const failingTwilioFetch = (async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") return new Response("{}", { status: 500 });
      return new Response(JSON.stringify({ voice_url: ORIGINAL_VOICE_URL }), { status: 200 });
    }) as never;
    const deps = { ...makeDeps(true), twilioFetch: failingTwilioFetch };
    const outcome = await runHealthCheckCycle(makeSql(store), deps);
    expect(outcome).toBe("recovery_restored");
    expect(store.get("retell_health_failover_voice_url_snapshot")).toEqual({
      PN1: ORIGINAL_VOICE_URL,
    });
  });
});
