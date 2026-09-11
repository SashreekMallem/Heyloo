import { describe, expect, it } from "vitest";
import { createLogger } from "../../_shared/logger.ts";
import type { SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";
import { lookupCustomer } from "./lookup_customer.ts";

const logger = createLogger();
const CALLER_NUMBER = "+15551234567";
const ctx: CallContext = {
  tenantId: "tenant_1",
  callLogId: "cl_1",
  retellCallId: "call_1",
  callerNumber: CALLER_NUMBER,
  vertical: "generic",
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

  it("surfaces saved delivery addresses from customer_addresses only when present", async () => {
    const sql = ((strings: TemplateStringsArray) => {
      const text = strings.join(" ");
      if (text.includes("from public.customers")) {
        return Promise.resolve([
          { id: "cust_1", name: "Jordan Lee", segment: "returning", metadata: {} },
        ]);
      }
      if (text.includes("from public.customer_addresses")) {
        return Promise.resolve([
          {
            id: "addr_1",
            label: "Home",
            street: "123 Main St",
            city: "Austin",
            state: "TX",
            zip: "78701",
            delivery_instructions: "Gate code 1234",
            is_default: true,
          },
        ]);
      }
      return Promise.resolve([]);
    }) as SqlClient;
    const result = await lookupCustomer(sql, ctx, { phone: CALLER_NUMBER }, logger);
    expect(result).toMatchObject({
      found: true,
      addresses: [{ id: "addr_1", street: "123 Main St", is_default: true }],
    });
  });

  it("CHANNELS-2 item 10(a): bounds vehicles/pets to 5, most-recent-first, flagging the most recent one", async () => {
    const sql = ((strings: TemplateStringsArray) => {
      const text = strings.join(" ");
      if (text.includes("from public.customers")) {
        return Promise.resolve([
          {
            id: "cust_1",
            name: "Jordan Lee",
            segment: "vip",
            // stored oldest-first, 7 entries — over the 5-entry cap.
            metadata: {
              vehicles: [
                { make: "Honda", model: "Civic", year: 2015 },
                { make: "Ford", model: "F-150", year: 2018 },
                { make: "Toyota", model: "Camry", year: 2019 },
                { make: "Honda", model: "CR-V", year: 2020 },
                { make: "Subaru", model: "Outback", year: 2021 },
                { make: "Kia", model: "Sorento", year: 2022 },
                { make: "Tesla", model: "Model 3", year: 2024 },
              ],
            },
          },
        ]);
      }
      return Promise.resolve([]);
    }) as SqlClient;
    const result = await lookupCustomer(sql, ctx, { phone: CALLER_NUMBER }, logger);
    const vehicles = (result as { vehicles?: Record<string, unknown>[] }).vehicles;
    expect(vehicles).toHaveLength(5);
    // most-recent-first (Tesla was appended last) and flagged.
    expect(vehicles?.[0]).toMatchObject({ make: "Tesla", most_recent: true });
    expect(vehicles?.[1]).toMatchObject({ make: "Kia" });
    expect(vehicles?.[1]?.["most_recent"]).toBeUndefined();
    expect(vehicles?.[4]).toMatchObject({ make: "Toyota" }); // the 5th most recent, 2 dropped
    expect(vehicles?.some((v) => v["make"] === "Honda" && v["model"] === "Civic")).toBe(false);
  });

  it("CHANNELS-2 item 10(a): a single saved vehicle is still flagged most_recent (the exactly-one case)", async () => {
    const sql = ((strings: TemplateStringsArray) => {
      const text = strings.join(" ");
      if (text.includes("from public.customers")) {
        return Promise.resolve([
          {
            id: "cust_1",
            name: "Jordan Lee",
            segment: "returning",
            metadata: { vehicles: [{ make: "Honda", model: "Civic" }] },
          },
        ]);
      }
      return Promise.resolve([]);
    }) as SqlClient;
    const result = await lookupCustomer(sql, ctx, { phone: CALLER_NUMBER }, logger);
    expect(result).toMatchObject({ vehicles: [{ make: "Honda", most_recent: true }] });
  });

  it("CHANNELS-2 item 10(a): bounds saved addresses to 5 at the query level (limit, most-default/recent first)", async () => {
    let sawLimit = false;
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("from public.customers")) {
        return Promise.resolve([
          { id: "cust_1", name: "Jordan Lee", segment: "returning", metadata: {} },
        ]);
      }
      if (text.includes("from public.customer_addresses")) {
        sawLimit = values.includes(5);
        return Promise.resolve([
          { id: "addr_1", street: "Home", is_default: true },
          { id: "addr_2", street: "Work", is_default: false },
        ]);
      }
      return Promise.resolve([]);
    }) as SqlClient;
    await lookupCustomer(sql, ctx, { phone: CALLER_NUMBER }, logger);
    expect(sawLimit).toBe(true);
  });

  it("omits addresses when the customer has none saved", async () => {
    const sql = ((strings: TemplateStringsArray) => {
      const text = strings.join(" ");
      if (text.includes("from public.customers")) {
        return Promise.resolve([
          { id: "cust_1", name: "Jordan Lee", segment: "returning", metadata: {} },
        ]);
      }
      return Promise.resolve([]);
    }) as SqlClient;
    const result = await lookupCustomer(sql, ctx, { phone: CALLER_NUMBER }, logger);
    expect((result as { addresses?: unknown }).addresses).toBeUndefined();
  });
});
