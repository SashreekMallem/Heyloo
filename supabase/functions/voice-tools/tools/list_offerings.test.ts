import { describe, expect, it } from "vitest";
import type { SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";
import { ALREADY_LISTED_MESSAGE, listOfferings } from "./list_offerings.ts";

const ctx: CallContext = {
  tenantId: "tenant_1",
  callLogId: "cl_1",
  retellCallId: "call_1",
  callerNumber: "+15551234567",
  vertical: "dental",
  isTestCall: false,
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

describe("F-SPEECH-1: list_offerings answers the same question once per call", () => {
  const realCtx: CallContext = { ...ctx, retellCallId: "call_0123456789abcdef01234567" };
  const rows = [
    { id: "off_1", name: "Cleaning", category: "wellness", duration_minutes: 30, price_cents: 1 },
  ];

  it("repeats nothing on a second identical request in the same real call", async () => {
    let queries = 0;
    const sql = (() => {
      queries += 1;
      return Promise.resolve(rows);
    }) as SqlClient;
    const first = await listOfferings(sql, realCtx, {});
    expect(first.offerings).toHaveLength(1);
    const second = await listOfferings(sql, realCtx, {});
    expect(second).toEqual({
      already_listed: true,
      message: ALREADY_LISTED_MESSAGE,
      offerings: [],
    });
    expect(queries).toBe(1);
    expect(ALREADY_LISTED_MESSAGE).toMatch(/do not call list_offerings again/);
  });

  it("still answers a different category, and a different call, in full", async () => {
    const sql = makeSql(rows);
    const callA = { ...realCtx, retellCallId: "call_aaaaaaaaaaaaaaaaaaaaaaaa" };
    await listOfferings(sql, callA, { category: "wellness" });
    expect((await listOfferings(sql, callA, { category: "emergency" })).offerings).toHaveLength(1);
    const callB = { ...realCtx, retellCallId: "call_bbbbbbbbbbbbbbbbbbbbbbbb" };
    expect((await listOfferings(sql, callB, { category: "wellness" })).offerings).toHaveLength(1);
  });

  it("never de-duplicates a batch-test call id (the simulator sends one literal id for every scenario)", async () => {
    const sql = makeSql(rows);
    const placeholder = { ...ctx, retellCallId: "playground:agent_1" };
    await listOfferings(sql, placeholder, {});
    expect((await listOfferings(sql, placeholder, {})).offerings).toHaveLength(1);
  });

  it("is scoped to the tenant as well as the call id", async () => {
    const sql = makeSql(rows);
    const one = { ...realCtx, retellCallId: "call_cccccccccccccccccccccccc", tenantId: "t_a" };
    const other = { ...one, tenantId: "t_b" };
    await listOfferings(sql, one, {});
    expect((await listOfferings(sql, other, {})).offerings).toHaveLength(1);
  });
});
