import { describe, expect, it } from "vitest";
import type { SqlClient } from "./types.ts";
import { insertWebhookEventIfNew, markWebhookEventProcessed } from "./webhook-dedup.ts";

function makeFakeSql(rows: unknown[]): { sql: SqlClient; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push([strings.raw.join("?"), ...values]);
    return Promise.resolve(rows);
  }) as SqlClient;
  return { sql, calls };
}

describe("insertWebhookEventIfNew", () => {
  it("returns isNew:true with the new row id on first insert", async () => {
    const { sql, calls } = makeFakeSql([{ id: "wh_1" }]);
    const result = await insertWebhookEventIfNew(sql, {
      source: "retell",
      eventId: "call_123:call_started",
      eventType: "call_started",
      payload: { call_id: "call_123" },
      signatureVerified: true,
    });
    expect(result).toEqual({ isNew: true, webhookEventId: "wh_1" });
    expect(calls[0]).toContain("retell");
    expect(calls[0]).toContain("call_123:call_started");
    expect(calls[0]).toContain(true);
  });

  it("returns isNew:false on a conflicting (already-seen) event id", async () => {
    const { sql } = makeFakeSql([]); // ON CONFLICT DO NOTHING -> no row returned
    const result = await insertWebhookEventIfNew(sql, {
      source: "stripe",
      eventId: "evt_dup",
      eventType: "invoice.paid",
      payload: {},
      signatureVerified: true,
    });
    expect(result).toEqual({ isNew: false });
  });
});

describe("markWebhookEventProcessed", () => {
  it("issues an update with the given id and null error on success", async () => {
    const calls: unknown[][] = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push([strings.raw.join("?"), ...values]);
      return Promise.resolve([]);
    }) as SqlClient;

    await markWebhookEventProcessed(sql, "wh_1");
    expect(calls[0]).toContain("wh_1");
    expect(calls[0]).toContain(null);
  });

  it("records a processing error when given one", async () => {
    const calls: unknown[][] = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push([strings.raw.join("?"), ...values]);
      return Promise.resolve([]);
    }) as SqlClient;

    await markWebhookEventProcessed(sql, "wh_1", "boom");
    expect(calls[0]).toContain("boom");
  });
});
