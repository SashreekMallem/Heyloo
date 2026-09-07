import { describe, expect, it } from "vitest";
import type { SqlClient } from "../_shared/types.js";
import { verifyForwarding } from "./handler.js";

describe("verifyForwarding", () => {
  it("returns 404 when the tenant has no active number", async () => {
    const sql = (() => Promise.resolve([])) as SqlClient;
    const result = await verifyForwarding(
      sql,
      { tenantId: "t1" },
      {
        now: () => new Date(),
        sleep: async () => {},
        pollIntervalMs: 10,
        timeoutMs: 100,
      },
    );
    expect(result.status).toBe(404);
  });

  it("returns verified:true as soon as a matching call_logs row appears", async () => {
    let callCount = 0;
    const sql = ((strings: TemplateStringsArray) => {
      const text = strings.join(" ");
      if (text.includes("from public.phone_numbers"))
        return Promise.resolve([{ id: "pn_1", e164: "+15551230000" }]);
      if (text.includes("from public.call_logs")) {
        callCount += 1;
        return Promise.resolve(callCount >= 2 ? [{ id: "cl_1" }] : []);
      }
      return Promise.resolve([]);
    }) as SqlClient;

    let now = 0;
    const result = await verifyForwarding(
      sql,
      { tenantId: "t1", carrierHint: "verizon" },
      {
        now: () => new Date(now),
        sleep: async (ms) => {
          now += ms;
        },
        pollIntervalMs: 10,
        timeoutMs: 5_000,
      },
    );
    expect(result).toEqual({
      status: 200,
      body: { verified: true, detected_carrier: "verizon", next_step: "complete" },
    });
  });

  it("times out with next_step:retry when no carrier hint was given", async () => {
    const sql = ((strings: TemplateStringsArray) => {
      const text = strings.join(" ");
      if (text.includes("from public.phone_numbers"))
        return Promise.resolve([{ id: "pn_1", e164: "+15551230000" }]);
      return Promise.resolve([]);
    }) as SqlClient;
    let now = 0;
    const result = await verifyForwarding(
      sql,
      { tenantId: "t1" },
      {
        now: () => new Date(now),
        sleep: async (ms) => {
          now += ms;
        },
        pollIntervalMs: 100,
        timeoutMs: 300,
      },
    );
    expect(result).toEqual({ status: 408, body: { verified: false, next_step: "retry" } });
  });

  it("times out with next_step:try_full_forward when a carrier hint was already given", async () => {
    const sql = ((strings: TemplateStringsArray) => {
      const text = strings.join(" ");
      if (text.includes("from public.phone_numbers"))
        return Promise.resolve([{ id: "pn_1", e164: "+15551230000" }]);
      return Promise.resolve([]);
    }) as SqlClient;
    let now = 0;
    const result = await verifyForwarding(
      sql,
      { tenantId: "t1", carrierHint: "att" },
      {
        now: () => new Date(now),
        sleep: async (ms) => {
          now += ms;
        },
        pollIntervalMs: 100,
        timeoutMs: 300,
      },
    );
    expect(result).toEqual({
      status: 408,
      body: { verified: false, next_step: "try_full_forward" },
    });
  });
});
