import { describe, expect, it } from "vitest";
import {
  archiveMessage,
  deleteMessage,
  enqueue,
  metricsAll,
  moveToDeadLetter,
  QUEUE_NAMES,
  readBatch,
} from "./queue.ts";
import type { SqlClient } from "./types.ts";

function makeFakeSql(rows: unknown[] = []): { sql: SqlClient; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push([strings.raw.join("?"), ...values]);
    return Promise.resolve(rows);
  }) as SqlClient;
  return { sql, calls };
}

describe("enqueue", () => {
  it("sends the raw message object to pgmq.send for the given queue", async () => {
    const { sql, calls } = makeFakeSql();
    await enqueue(sql, QUEUE_NAMES.messagesOutbound, { message_id: "m1" });
    expect(calls[0]).toContain(QUEUE_NAMES.messagesOutbound);
    expect(calls[0]).toContainEqual({ message_id: "m1" });
  });

  // Regression (CALL-3 jsonb double-encoding fix): under postgres.js with
  // prepare:true, `${JSON.stringify(x)}::jsonb` double-encodes because the
  // driver's own learned-type serializer re-serializes an already-stringified
  // value — the parameter passed for a `::jsonb` cast must be the raw
  // object/array, never a pre-stringified string.
  it("never pre-stringifies the message parameter passed for the ::jsonb cast", async () => {
    const { sql, calls } = makeFakeSql();
    await enqueue(sql, QUEUE_NAMES.messagesOutbound, { message_id: "m1" });
    const jsonbParam = calls[0]?.find(
      (v) => typeof v === "object" && v !== null && "message_id" in (v as object),
    );
    expect(typeof jsonbParam).not.toBe("string");
    expect(jsonbParam).toEqual({ message_id: "m1" });
  });
});

describe("readBatch", () => {
  it("reads a batch via pgmq.read with the given visibility timeout and quantity", async () => {
    const rows = [
      { msg_id: 1, read_ct: 1, enqueued_at: "now", vt: "now", message: { call_id: "c1" } },
    ];
    const { sql, calls } = makeFakeSql(rows);
    const result = await readBatch(sql, QUEUE_NAMES.recordingFetch, 60, 10);
    expect(result).toEqual(rows);
    expect(calls[0]).toContain(QUEUE_NAMES.recordingFetch);
    expect(calls[0]).toContain(60);
    expect(calls[0]).toContain(10);
  });
});

describe("deleteMessage / archiveMessage", () => {
  it("deletes by queue + msg_id", async () => {
    const { sql, calls } = makeFakeSql();
    await deleteMessage(sql, QUEUE_NAMES.adapterPush, 42);
    expect(calls[0]).toContain(QUEUE_NAMES.adapterPush);
    expect(calls[0]).toContain(42);
  });

  it("archives by queue + msg_id", async () => {
    const { sql, calls } = makeFakeSql();
    await archiveMessage(sql, QUEUE_NAMES.outreachSend, 7);
    expect(calls[0]).toContain(QUEUE_NAMES.outreachSend);
    expect(calls[0]).toContain(7);
  });
});

describe("moveToDeadLetter", () => {
  it("sends to the <queue>_dlq companion queue then archives the source message", async () => {
    const { sql, calls } = makeFakeSql();
    await moveToDeadLetter(
      sql,
      QUEUE_NAMES.messagesOutbound,
      9,
      { message_id: "m9" },
      "max_attempts_exceeded:twilio_send_transient_failure:503",
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain(`${QUEUE_NAMES.messagesOutbound}_dlq`);
    expect(calls[1]).toContain(QUEUE_NAMES.messagesOutbound);
    expect(calls[1]).toContain(9);
  });

  // OPS-8 regression: every dead-lettered message must carry a recorded
  // `reason` and the original message nested under `message`, never just
  // the raw original payload — an admin reading `_dlq` needs to know WHY
  // without cross-referencing logs.
  it("wraps the DLQ payload with reason, dead_lettered_at, and the original message", async () => {
    const { sql, calls } = makeFakeSql();
    await moveToDeadLetter(
      sql,
      QUEUE_NAMES.recordingFetch,
      3,
      { call_id: "c1", retell_call_id: "call_1", attempt: 8 },
      "provider_not_configured",
    );
    const dlqPayload = calls[0]?.find(
      (v) => typeof v === "object" && v !== null && "reason" in (v as object),
    ) as { reason: string; dead_lettered_at: string; message: unknown } | undefined;
    expect(dlqPayload?.reason).toBe("provider_not_configured");
    expect(typeof dlqPayload?.dead_lettered_at).toBe("string");
    expect(dlqPayload?.message).toEqual({ call_id: "c1", retell_call_id: "call_1", attempt: 8 });
  });
});

describe("metricsAll", () => {
  it("reads every queue's metrics via pgmq.metrics_all()", async () => {
    const rows = [
      {
        queue_name: "recording_fetch_queue",
        queue_length: 5,
        newest_msg_age_sec: 10,
        oldest_msg_age_sec: 45000,
        total_messages: 5,
        queue_visible_length: 5,
      },
    ];
    const { sql, calls } = makeFakeSql(rows);
    const result = await metricsAll(sql);
    expect(result).toEqual(rows);
    expect(calls[0]?.[0]).toContain("pgmq.metrics_all");
  });
});
