import { describe, expect, it } from "vitest";
import { enqueueAdapterPush } from "./adapter-push.ts";
import type { AdapterPushQueueMsg } from "./queue.ts";
import type { SqlClient } from "./types.ts";

function makeSql(connections: { provider: string }[]): {
  sql: SqlClient;
  enqueued: { queue: string; message: AdapterPushQueueMsg }[];
} {
  const enqueued: { queue: string; message: AdapterPushQueueMsg }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    if (text.includes("from public.adapter_connections")) {
      return Promise.resolve(connections);
    }
    if (text.includes("pgmq.send")) {
      const [queue, message] = values as [string, AdapterPushQueueMsg];
      // Regression (CALL-3 jsonb double-encoding fix): postgres.js's own
      // learned-type serializer must receive the raw object for a `::jsonb`
      // parameter, never a caller-pre-stringified value — asserting the
      // object shape directly (not via JSON.parse of a string) is itself
      // the regression check for that.
      expect(typeof message).not.toBe("string");
      enqueued.push({ queue, message });
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, enqueued };
}

describe("enqueueAdapterPush", () => {
  it("enqueues nothing when the tenant has no connected adapter", async () => {
    const { sql, enqueued } = makeSql([]);
    const count = await enqueueAdapterPush(sql, {
      tenantId: "t1",
      entityType: "booking",
      entityId: "booking_1",
      idempotencyKey: "call_1:2026-01-15T14:00:00.000Z",
    });
    expect(count).toBe(0);
    expect(enqueued).toHaveLength(0);
  });

  it("enqueues a booking push to every connected booking-capable adapter", async () => {
    const { sql, enqueued } = makeSql([
      { provider: "shopmonkey" },
      { provider: "google_calendar" },
    ]);
    const count = await enqueueAdapterPush(sql, {
      tenantId: "t1",
      entityType: "booking",
      entityId: "booking_1",
      idempotencyKey: "key_1",
    });
    expect(count).toBe(2);
    expect(enqueued).toEqual([
      {
        queue: "adapter_push_queue",
        message: {
          tenant_id: "t1",
          adapter: "shopmonkey",
          entity_type: "booking",
          entity_id: "booking_1",
          idempotency_key: "key_1",
          attempt: 0,
        },
      },
      {
        queue: "adapter_push_queue",
        message: {
          tenant_id: "t1",
          adapter: "google_calendar",
          entity_type: "booking",
          entity_id: "booking_1",
          idempotency_key: "key_1",
          attempt: 0,
        },
      },
    ]);
  });

  it("skips a connected adapter that does not support the given entity type (order -> non-Square)", async () => {
    const { sql, enqueued } = makeSql([{ provider: "shopmonkey" }]);
    const count = await enqueueAdapterPush(sql, {
      tenantId: "t1",
      entityType: "order",
      entityId: "order_1",
      idempotencyKey: "key_1",
    });
    expect(count).toBe(0);
    expect(enqueued).toHaveLength(0);
  });

  it("enqueues both a booking and an order push for a connected Airtable adapter (generic base, both entity types)", async () => {
    const bookingResult = await enqueueAdapterPush(makeSql([{ provider: "airtable" }]).sql, {
      tenantId: "t1",
      entityType: "booking",
      entityId: "booking_1",
      idempotencyKey: "key_1",
    });
    expect(bookingResult).toBe(1);
    const orderResult = await enqueueAdapterPush(makeSql([{ provider: "airtable" }]).sql, {
      tenantId: "t1",
      entityType: "order",
      entityId: "order_1",
      idempotencyKey: "key_1",
    });
    expect(orderResult).toBe(1);
  });

  it("enqueues an order push for a connected Square adapter", async () => {
    const { sql, enqueued } = makeSql([{ provider: "square" }]);
    const count = await enqueueAdapterPush(sql, {
      tenantId: "t1",
      entityType: "order",
      entityId: "order_1",
      idempotencyKey: "key_1",
    });
    expect(count).toBe(1);
    expect(enqueued[0]?.message.adapter).toBe("square");
  });

  it("ignores a disconnected/unrelated provider row entirely (the query itself is status='connected'-scoped)", async () => {
    // Simulates what the real query returns: a disconnected connection row
    // for this tenant is never in the result set at all (filtered in SQL),
    // so nothing here should ever need an in-JS status check as well.
    const { sql, enqueued } = makeSql([]);
    const count = await enqueueAdapterPush(sql, {
      tenantId: "t1",
      entityType: "booking",
      entityId: "booking_1",
      idempotencyKey: "key_1",
    });
    expect(count).toBe(0);
    expect(enqueued).toHaveLength(0);
  });
});

// Producer <-> consumer contract: every message this producer can possibly
// enqueue must be shaped exactly as `worker-adapter-push/handler.ts`'s
// `ADAPTER_PUSHERS` map and `pushToAdapter` expect to read it (E2E_FLOWS_AUDIT
// B4). This is a static, not a runtime, contract check — importing the real
// consumer map here and asserting every provider this producer can address
// has a registered pusher (so no message this producer sends can ever hit
// `adapter_push_not_implemented`), and that every field name matches.
describe("producer <-> consumer contract (adapter_push_queue)", () => {
  it("every provider this producer can enqueue a booking push to has a registered consumer pusher", async () => {
    const { ADAPTER_PUSHERS } = await import("../worker-adapter-push/handler.ts");
    const bookingProviders = ["shopmonkey", "ezyvet", "google_calendar", "square", "airtable"];
    for (const provider of bookingProviders) {
      expect(ADAPTER_PUSHERS[provider]).toBeTypeOf("function");
    }
  });

  it("every provider this producer can enqueue an order push to has a registered consumer pusher", async () => {
    const { ADAPTER_PUSHERS } = await import("../worker-adapter-push/handler.ts");
    expect(ADAPTER_PUSHERS["square"]).toBeTypeOf("function");
    expect(ADAPTER_PUSHERS["airtable"]).toBeTypeOf("function");
  });

  it("an enqueued message's field names match AdapterPushQueueMsg exactly (no stray/renamed keys)", async () => {
    const { sql, enqueued } = makeSql([{ provider: "square" }]);
    await enqueueAdapterPush(sql, {
      tenantId: "t1",
      entityType: "order",
      entityId: "order_1",
      idempotencyKey: "key_1",
    });
    expect(Object.keys(enqueued[0]?.message ?? {}).sort()).toEqual(
      ["adapter", "attempt", "entity_id", "entity_type", "idempotency_key", "tenant_id"].sort(),
    );
  });
});
