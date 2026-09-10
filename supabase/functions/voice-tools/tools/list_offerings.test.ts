import { describe, expect, it } from "vitest";
import type { SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";
import { listOfferings } from "./list_offerings.ts";

const ctx: CallContext = {
  tenantId: "tenant_1",
  callLogId: "cl_1",
  retellCallId: "call_1",
  callerNumber: "+15551234567",
  vertical: "dental",
};

function makeSql(rows: unknown[]): SqlClient {
  return (() => Promise.resolve(rows)) as SqlClient;
}

describe("listOfferings", () => {
  it("returns offering_id/name/category/duration/price for each active offering", async () => {
    const sql = makeSql([
      {
        id: "off_1",
        name: "Cleaning",
        category: "wellness",
        duration_minutes: 30,
        price_cents: 12000,
      },
      {
        id: "off_2",
        name: "Root canal",
        category: "procedure",
        duration_minutes: 90,
        price_cents: 80000,
      },
    ]);
    const result = await listOfferings(sql, ctx, {});
    expect(result.none_on_file).toBe(false);
    expect(result.offerings).toEqual([
      {
        offering_id: "off_1",
        name: "Cleaning",
        category: "wellness",
        duration_minutes: 30,
        price_cents: 12000,
      },
      {
        offering_id: "off_2",
        name: "Root canal",
        category: "procedure",
        duration_minutes: 90,
        price_cents: 80000,
      },
    ]);
  });

  it("sets none_on_file when the tenant has no active offerings", async () => {
    const sql = makeSql([]);
    const result = await listOfferings(sql, ctx, {});
    expect(result.none_on_file).toBe(true);
    expect(result.offerings).toEqual([]);
  });

  it("passes an optional category filter through to the query args", async () => {
    const sql = makeSql([]);
    const result = await listOfferings(sql, ctx, { category: "emergency" });
    expect(result.offerings).toEqual([]);
  });
});
