import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import { createPhoneNumberRegistry } from "../_shared/providers/phone-numbers/registry.ts";
import type { SqlClient } from "../_shared/types.ts";
import { runHealthCheckCycle } from "./handler.ts";

const logger = createLogger();
const ORIGINAL_VOICE_URL = "https://api.retellai.com/twilio-voice-webhook/agent_1";

interface NumberFixture {
  id: string;
  tenant_id: string;
  e164: string;
  twilio_sid: string | null;
}

const TWILIO_NUMBER: NumberFixture = {
  id: "pn1",
  tenant_id: "t1",
  e164: "+15551110001",
  twilio_sid: "PN1",
};
const NATIVE_NUMBER: NumberFixture = {
  id: "pn2",
  tenant_id: "t2",
  e164: "+15551110002",
  twilio_sid: null,
};
const ATTACHED_NUMBER: NumberFixture = {
  id: "pn3",
  tenant_id: "t3",
  e164: "+15551110003",
  twilio_sid: "retell-native:+15551110003",
};

interface SqlRecord {
  text: string;
  values: unknown[];
}

function makeSql(
  settingsStore: Map<string, unknown>,
  numbers: NumberFixture[] = [TWILIO_NUMBER],
  recorded: SqlRecord[] = [],
): SqlClient {
  return ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    recorded.push({ text, values });
    if (text.includes("select value from public.platform_settings")) {
      const key = values[0] as string;
      const value = settingsStore.get(key);
      return Promise.resolve(value !== undefined ? [{ value }] : []);
    }
    if (text.includes("insert into public.platform_settings")) {
      const key = values[0] as string;
      const value = values[1];
      // Regression (CALL-3 jsonb double-encoding fix): the ::jsonb parameter
      // must be the raw object, never a caller-pre-stringified JSON string
      // (postgres.js's own learned-type serializer handles the encoding).
      if (typeof value === "string") {
        throw new Error(
          `platform_settings.value bound as a pre-stringified string, not an object: ${value}`,
        );
      }
      settingsStore.set(key, value);
      return Promise.resolve([]);
    }
    if (text.includes("from public.phone_numbers")) {
      return Promise.resolve(numbers);
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

function makeDeps(
  healthy: boolean,
  twilioCalls: TwilioCall[] = [],
  extra: {
    twilioAccountSid?: string | undefined;
    twilioAuthToken?: string | undefined;
    failoverVoiceUrl?: string | undefined;
    twilioFetch?: never;
  } = {},
) {
  const retellFetch = (() =>
    healthy
      ? Promise.resolve(new Response("{}", { status: 200 }))
      : Promise.reject(new Error("down"))) as never;
  const has = (k: keyof typeof extra) => k in extra;
  const twilioFetch = extra.twilioFetch ?? makeTwilioFetch(twilioCalls);
  return {
    retellFetch,
    retellApiKey: "key",
    numbers: createPhoneNumberRegistry({
      retellFetch,
      retellApiKey: "key",
      protectedAgentIds: [],
      twilioFetch,
      twilioAccountSid: has("twilioAccountSid") ? extra.twilioAccountSid : "AC1",
      twilioAuthToken: has("twilioAuthToken") ? extra.twilioAuthToken : "token",
    }),
    failoverVoiceUrl: has("failoverVoiceUrl")
      ? extra.failoverVoiceUrl
      : "https://heyloo.example.com/failover-twiml",
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
    const deps = makeDeps(true, [], { twilioFetch: failingTwilioFetch });
    const outcome = await runHealthCheckCycle(makeSql(store), deps);
    expect(outcome).toBe("recovery_restored");
    expect(store.get("retell_health_failover_voice_url_snapshot")).toEqual({
      PN1: ORIGINAL_VOICE_URL,
    });
  });
});

async function tripFailover(
  store: Map<string, unknown>,
  numbers: NumberFixture[],
  deps: ReturnType<typeof makeDeps>,
  recorded: SqlRecord[],
) {
  let outcome = "";
  for (let i = 0; i < 3; i += 1) {
    outcome = await runHealthCheckCycle(makeSql(store, numbers, recorded), deps);
  }
  return outcome;
}

const alertInserts = (recorded: SqlRecord[]) =>
  recorded.filter((r) => r.text.includes("insert into public.alerts"));

describe("runHealthCheckCycle — Retell-native numbers (NUMBERS-1)", () => {
  for (const [label, number] of [
    ["NULL twilio_sid", NATIVE_NUMBER],
    ["retell-native:<e164> placeholder", ATTACHED_NUMBER],
  ] as const) {
    it(`never calls Twilio for a number with ${label}: skipped with a logged reason and one critical ops alert, incident still flagged`, async () => {
      const store = new Map<string, unknown>();
      const calls: TwilioCall[] = [];
      const recorded: SqlRecord[] = [];
      const outcome = await tripFailover(store, [number], makeDeps(false, calls), recorded);
      expect(outcome).toBe("failover_triggered");
      expect(store.get("platform_incident_retell_outage")).toEqual({ active: true });
      expect(calls).toEqual([]);
      const alerts = alertInserts(recorded);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]?.values).toEqual(
        expect.arrayContaining(["retell_failover_not_applicable", "critical", number.tenant_id]),
      );
      const payload = alerts[0]?.values.find((v) => typeof v === "object" && v !== null) as {
        provider: string;
        reason: string;
      };
      expect(payload.provider).toBe("retell-native");
      expect(payload.reason).toContain("retell_native_number");
      // Nothing snapshotted: there was no VoiceUrl to capture.
      expect(store.get("retell_health_failover_voice_url_snapshot")).toBeUndefined();
    });
  }

  it("diverts only the Twilio-imported number in a mixed fleet", async () => {
    const store = new Map<string, unknown>();
    const calls: TwilioCall[] = [];
    const recorded: SqlRecord[] = [];
    await tripFailover(
      store,
      [TWILIO_NUMBER, NATIVE_NUMBER, ATTACHED_NUMBER],
      makeDeps(false, calls),
      recorded,
    );
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]);
    expect(calls.every((c) => c.url.includes("/PN1.json"))).toBe(true);
    expect(alertInserts(recorded)).toHaveLength(2);
  });

  it("runs the probe and flags the incident even when Twilio and the failover URL are unconfigured; Twilio numbers are then skipped with an alert, not called", async () => {
    const store = new Map<string, unknown>();
    const calls: TwilioCall[] = [];
    const recorded: SqlRecord[] = [];
    const deps = makeDeps(false, calls, {
      twilioAccountSid: undefined,
      twilioAuthToken: undefined,
      failoverVoiceUrl: undefined,
    });
    const outcome = await tripFailover(store, [TWILIO_NUMBER, NATIVE_NUMBER], deps, recorded);
    expect(outcome).toBe("failover_triggered");
    expect(calls).toEqual([]);
    expect(alertInserts(recorded)).toHaveLength(2);
  });

  it("with a configured Twilio but no failover URL, a Twilio number is skipped with reason failover_voice_url_not_configured", async () => {
    const store = new Map<string, unknown>();
    const recorded: SqlRecord[] = [];
    const calls: TwilioCall[] = [];
    await tripFailover(
      store,
      [TWILIO_NUMBER],
      makeDeps(false, calls, { failoverVoiceUrl: undefined }),
      recorded,
    );
    expect(calls).toEqual([]);
    const payload = alertInserts(recorded)[0]?.values.find(
      (v) => typeof v === "object" && v !== null,
    ) as { reason: string };
    expect(payload.reason).toBe("failover_voice_url_not_configured");
  });

  it("on recovery never touches Twilio for Retell-native numbers and resolves the not-applicable alerts", async () => {
    const store = new Map<string, unknown>([
      ["platform_incident_retell_outage", { active: true }],
      ["retell_health_failover_voice_url_snapshot", { PN1: ORIGINAL_VOICE_URL }],
    ]);
    const calls: TwilioCall[] = [];
    const recorded: SqlRecord[] = [];
    const outcome = await runHealthCheckCycle(
      makeSql(store, [TWILIO_NUMBER, NATIVE_NUMBER, ATTACHED_NUMBER], recorded),
      makeDeps(true, calls),
    );
    expect(outcome).toBe("recovery_restored");
    expect(calls).toEqual([
      { method: "POST", url: expect.stringContaining("/IncomingPhoneNumbers/PN1.json") },
    ]);
    const resolve = recorded.find((r) => r.text.includes("update public.alerts"));
    expect(resolve?.values).toEqual(["retell_failover_not_applicable"]);
  });
});
