import { describe, expect, it } from "vitest";
import { createLogger } from "../../_shared/logger.js";
import type { SqlClient } from "../../_shared/types.js";
import type { CallContext } from "../context.js";
import { lookupCustomer } from "./lookup_customer.js";

const logger = createLogger();
const CALLER_NUMBER = "+15551234567";
const ctx: CallContext = {
  tenantId: "tenant_1",
  callLogId: "cl_1",
  retellCallId: "call_1",
  callerNumber: CALLER_NUMBER,
};

describe("lookupCustomer (G6 caller-scope authorization)", () => {
  it("rejects a lookup for a phone number different from the live caller's, without querying the DB", async () => {
    const sql = (() => Promise.resolve([])) as SqlClient;
    const result = await lookupCustomer(sql, ctx, { phone: "+15559998888" }, logger);
    expect(result).toEqual({ error: "unauthorized_lookup" });
  });

  it("logs the unauthorized attempt as a potential prompt-injection signal", async () => {
    const warnings: unknown[] = [];
    const spyLogger = {
      ...logger,
      warn: (msg: string, fields?: unknown) => warnings.push({ msg, fields }),
    };
    const sql = (() => Promise.resolve([])) as SqlClient;
    await lookupCustomer(sql, ctx, { phone: "+15559998888" }, spyLogger);
    expect(warnings).toHaveLength(1);
    expect((warnings[0] as { msg: string }).msg).toBe("lookup_customer_unauthorized_attempt");
  });

  it("allows the lookup when the requested phone matches the live caller (different formatting, same number)", async () => {
    let queried = false;
    const sql = ((strings: TemplateStringsArray) => {
      queried = true;
      if (strings.join(" ").includes("from public.customers")) {
        return Promise.resolve([
          { id: "cust_1", name: "Jordan Lee", segment: "returning", metadata: {} },
        ]);
      }
      return Promise.resolve([]);
    }) as SqlClient;
    const result = await lookupCustomer(sql, ctx, { phone: "(555) 123-4567" }, logger);
    expect(queried).toBe(true);
    expect(result).toMatchObject({ found: true, name: "Jordan Lee", segment: "returning" });
  });

  it("returns found:false when no customer row exists yet", async () => {
    const sql = (() => Promise.resolve([])) as SqlClient;
    const result = await lookupCustomer(sql, ctx, { phone: CALLER_NUMBER }, logger);
    expect(result).toEqual({ found: false });
  });

  it("surfaces vertical metadata (vehicles/pets) only when present", async () => {
    const sql = ((strings: TemplateStringsArray) => {
      const text = strings.join(" ");
      if (text.includes("from public.customers")) {
        return Promise.resolve([
          {
            id: "cust_1",
            name: "Jordan Lee",
            segment: "vip",
            metadata: { vehicles: [{ make: "Honda" }] },
          },
        ]);
      }
      return Promise.resolve([]);
    }) as SqlClient;
    const result = await lookupCustomer(sql, ctx, { phone: CALLER_NUMBER }, logger);
    expect(result).toMatchObject({ found: true, vehicles: [{ make: "Honda" }] });
    expect((result as { pets?: unknown }).pets).toBeUndefined();
  });
});
