import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.js";
import type { SqlClient } from "../_shared/types.js";
import { runHealthCheckCycle } from "./handler.js";

const logger = createLogger();

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

function makeDeps(healthy: boolean) {
  return {
    retellFetch: (() =>
      healthy
        ? Promise.resolve(new Response("{}", { status: 200 }))
        : Promise.reject(new Error("down"))) as never,
    retellApiKey: "key",
    twilioFetch: (() => Promise.resolve(new Response("{}", { status: 200 }))) as never,
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

  it("triggers failover on the 3rd consecutive failure", async () => {
    const store = new Map<string, unknown>();
    const deps = makeDeps(false);
    await runHealthCheckCycle(makeSql(store), deps);
    await runHealthCheckCycle(makeSql(store), deps);
    const outcome = await runHealthCheckCycle(makeSql(store), deps);
    expect(outcome).toBe("failover_triggered");
    expect(store.get("platform_incident_retell_outage")).toEqual({ active: true });
  });

  it("stays in still_incident_no_change while an incident is already active and Retell is still down", async () => {
    const store = new Map<string, unknown>([["platform_incident_retell_outage", { active: true }]]);
    const outcome = await runHealthCheckCycle(makeSql(store), makeDeps(false));
    expect(outcome).toBe("still_incident_no_change");
  });

  it("restores and clears the incident flag on recovery", async () => {
    const store = new Map<string, unknown>([
      ["platform_incident_retell_outage", { active: true }],
      ["retell_health_consecutive_failures", { count: 5 }],
    ]);
    const outcome = await runHealthCheckCycle(makeSql(store), makeDeps(true));
    expect(outcome).toBe("recovery_restored");
    expect(store.get("platform_incident_retell_outage")).toEqual({ active: false });
    expect(store.get("retell_health_consecutive_failures")).toEqual({ count: 0 });
  });
});
