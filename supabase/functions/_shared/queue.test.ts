import { describe, expect, it } from "vitest";
import {
  archiveMessage,
  deleteMessage,
  enqueue,
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
  it("sends a JSON-encoded message to pgmq.send for the given queue", async () => {
    const { sql, calls } = makeFakeSql();
    await enqueue(sql, QUEUE_NAMES.messagesOutbound, { message_id: "m1" });
    expect(calls[0]).toContain(QUEUE_NAMES.messagesOutbound);
    expect(calls[0]).toContain(JSON.stringify({ message_id: "m1" }));
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
    await moveToDeadLetter(sql, QUEUE_NAMES.messagesOutbound, 9, { message_id: "m9" });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain(`${QUEUE_NAMES.messagesOutbound}_dlq`);
    expect(calls[1]).toContain(QUEUE_NAMES.messagesOutbound);
    expect(calls[1]).toContain(9);
  });
});
