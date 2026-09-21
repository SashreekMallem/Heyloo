import { describe, expect, it, vi } from "vitest";
import type { Logger, SqlClient } from "../_shared/types.ts";
import type { RecordingFetchDeps } from "./handler.ts";
import { fetchAndStoreRecording, runRecordingFetchWorker } from "./handler.ts";

function makeSql(handlers: Record<string, (values: unknown[]) => unknown[]> = {}): {
  sql: SqlClient;
  calls: { text: string; values: unknown[] }[];
} {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    for (const [key, handler] of Object.entries(handlers)) {
      if (text.includes(key)) return Promise.resolve(handler(values));
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const params = { callId: "cl_1", retellCallId: "call_1", tenantId: "t1" };

describe("fetchAndStoreRecording", () => {
  it("returns not_ready when Retell hasn't produced a recording_url yet", async () => {
    const { sql } = makeSql();
    const deps: RecordingFetchDeps = {
      retellFetch: (() =>
        Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))) as never,
      retellApiKey: "key",
      uploadToStorage: async () => ({ ok: true }),
      fetchRecordingBytes: async () => new ArrayBuffer(8),
    };
    const outcome = await fetchAndStoreRecording(sql, params, deps);
    expect(outcome.outcome).toBe("not_ready");
  });

  it("returns call_not_found when Retell's get-call errors", async () => {
    const { sql } = makeSql();
    const deps: RecordingFetchDeps = {
      retellFetch: (() => Promise.resolve(new Response("{}", { status: 404 }))) as never,
      retellApiKey: "key",
      uploadToStorage: async () => ({ ok: true }),
      fetchRecordingBytes: async () => new ArrayBuffer(8),
    };
    const outcome = await fetchAndStoreRecording(sql, params, deps);
    expect(outcome.outcome).toBe("call_not_found");
  });

  it("stores mono (and stereo, when present) and updates call_logs on success", async () => {
    const { sql, calls } = makeSql();
    const uploaded: string[] = [];
    const deps: RecordingFetchDeps = {
      retellFetch: (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              recording_url: "https://retell/mono.wav",
              recording_multi_channel_url: "https://retell/stereo.wav",
            }),
            { status: 200 },
          ),
        )) as never,
      retellApiKey: "key",
      uploadToStorage: async (path) => {
        uploaded.push(path);
        return { ok: true };
      },
      fetchRecordingBytes: async () => new ArrayBuffer(8),
    };
    const outcome = await fetchAndStoreRecording(sql, params, deps);
    expect(outcome.outcome).toBe("stored");
    // DASH-2 (docs/BUILD_NOTES.md): bucket-relative, no `recordings/`
    // prefix baked in — LOGIN-1 found the old prefixed form caused a
    // double-prefixed, non-existent Storage lookup at read time.
    expect(uploaded).toContain("t1/cl_1.wav");
    expect(uploaded).toContain("t1/cl_1_stereo.wav");
    const update = calls.find((c) => c.text.includes("update public.call_logs"));
    expect(update?.values).toContain("t1/cl_1.wav");
  });

  // DASH-2 (docs/BUILD_NOTES.md): the write side only ever produces the
  // new bucket-relative form going forward (no migration of existing
  // rows — see this task's BUILD_NOTES entry); the READ side's tolerance
  // of the old, `recordings/`-prefixed form left behind by pre-DASH-2
  // rows is covered by `apps/web/.../calls/[id]/recording/route.test.ts`'s
  // "strips a legacy recordings/ prefix" case.
  it("never bakes a recordings/ bucket prefix into either stored path, even for a mono-only call", async () => {
    const { sql, calls } = makeSql();
    const uploaded: string[] = [];
    const deps: RecordingFetchDeps = {
      retellFetch: (() =>
        Promise.resolve(
          new Response(JSON.stringify({ recording_url: "https://retell/mono.wav" }), {
            status: 200,
          }),
        )) as never,
      retellApiKey: "key",
      uploadToStorage: async (path) => {
        uploaded.push(path);
        return { ok: true };
      },
      fetchRecordingBytes: async () => new ArrayBuffer(8),
    };
    const outcome = await fetchAndStoreRecording(sql, params, deps);
    expect(outcome.outcome).toBe("stored");
    expect(uploaded).toEqual(["t1/cl_1.wav"]);
    for (const path of uploaded) {
      expect(path.startsWith("recordings/")).toBe(false);
    }
    const update = calls.find((c) => c.text.includes("update public.call_logs"));
    expect(update?.values).toContain("t1/cl_1.wav");
    expect(update?.values).toContain(null); // no stereo path for this call
  });

  it("returns upload_failed when the mono upload fails", async () => {
    const { sql } = makeSql();
    const deps: RecordingFetchDeps = {
      retellFetch: (() =>
        Promise.resolve(
          new Response(JSON.stringify({ recording_url: "https://retell/mono.wav" }), {
            status: 200,
          }),
        )) as never,
      retellApiKey: "key",
      uploadToStorage: async () => ({ ok: false }),
      fetchRecordingBytes: async () => new ArrayBuffer(8),
    };
    const outcome = await fetchAndStoreRecording(sql, params, deps);
    expect(outcome.outcome).toBe("upload_failed");
  });
});

// OPS-8 (docs/BUILD_NOTES.md): live root cause was `runRecordingFetchWorker`
// letting an exception ANYWHERE in one row's processing — originally the
// un-try/catched tenant lookup specifically — propagate out of the whole
// `for` loop, permanently stranding every message pgmq.read had already
// bumped read_ct for that tick (confirmed live: read_ct 470+, message body
// still `"attempt":0`, queue never drained). These tests pin the fixed
// per-row isolation directly.
describe("runRecordingFetchWorker", () => {
  const batchRow = (over: {
    msgId: number;
    readCt?: number;
    callId: string;
    retellCallId: string;
    attempt: number;
  }) => ({
    msg_id: over.msgId,
    read_ct: over.readCt ?? over.attempt + 1,
    enqueued_at: "now",
    vt: "now",
    message: { call_id: over.callId, retell_call_id: over.retellCallId, attempt: over.attempt },
  });

  it("keeps processing the rest of the batch when one row's tenant lookup throws", async () => {
    const batch = [
      batchRow({ msgId: 1, callId: "cl_a", retellCallId: "call_a", attempt: 0 }),
      batchRow({ msgId: 2, callId: "cl_b", retellCallId: "call_b", attempt: 0 }),
    ];
    const calls: { text: string; values: unknown[] }[] = [];
    const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      calls.push({ text, values });
      if (text.includes("pgmq.read")) return batch;
      if (text.includes("from public.call_logs where id")) {
        if (values[0] === "cl_a") throw new Error("connection reset");
        return [{ tenant_id: "t2" }];
      }
      return [];
    }) as SqlClient;

    const deps: RecordingFetchDeps = {
      retellFetch: (() =>
        Promise.resolve(
          new Response(JSON.stringify({ recording_url: "https://retell/mono.wav" }), {
            status: 200,
          }),
        )) as never,
      retellApiKey: "key",
      uploadToStorage: async () => ({ ok: true }),
      fetchRecordingBytes: async () => new ArrayBuffer(8),
    };

    const result = await runRecordingFetchWorker(sql, deps, makeLogger());

    // Row b was still fully processed and stored despite row a's throw —
    // pre-fix, this would have been 0 (the loop aborted on row a).
    expect(result.stored).toBe(1);
    expect(result.batch_size).toBe(2);
    // Row a went through the normal retry path (delete + re-enqueue with
    // attempt+1), not a silent, permanent stall.
    expect(result.retried).toBe(1);
    expect(result.dead_lettered).toBe(0);
  });

  it("dead-letters with a recorded reason once max attempts is reached", async () => {
    const batch = [batchRow({ msgId: 5, callId: "cl_x", retellCallId: "call_x", attempt: 7 })];
    const calls: { text: string; values: unknown[] }[] = [];
    const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      calls.push({ text, values });
      if (text.includes("pgmq.read")) return batch;
      if (text.includes("from public.call_logs where id")) return [{ tenant_id: "t1" }];
      return [];
    }) as SqlClient;
    const deps: RecordingFetchDeps = {
      // No recording_url yet — Retell hasn't finished processing.
      retellFetch: (() => Promise.resolve(new Response("{}", { status: 200 }))) as never,
      retellApiKey: "key",
      uploadToStorage: async () => ({ ok: true }),
      fetchRecordingBytes: async () => new ArrayBuffer(8),
    };

    const result = await runRecordingFetchWorker(sql, deps, makeLogger());

    expect(result.stored).toBe(0);
    expect(result.dead_lettered).toBe(1);
    const dlqCall = calls.find(
      (c) =>
        c.text.includes("pgmq.send") && String(c.values[0]).includes("recording_fetch_queue_dlq"),
    );
    expect(dlqCall).toBeDefined();
    const payload = dlqCall?.values.find(
      (v) => typeof v === "object" && v !== null && "reason" in (v as object),
    ) as { reason: string } | undefined;
    expect(payload?.reason).toContain("max_attempts_exceeded");
    expect(payload?.reason).toContain("not_ready");
  });

  // OPS-8: `row_outcomes` is what actually surfaced this task's second,
  // deeper root cause (queue.ts's pgmq.delete/archive overload ambiguity)
  // live, when edge-log queries were unreliable — kept as a permanent,
  // bounded diagnostic in the response for the same reason.
  it("reports a row_outcomes entry with the reason for every row that didn't get stored", async () => {
    const batch = [batchRow({ msgId: 5, callId: "cl_x", retellCallId: "call_x", attempt: 0 })];
    const sql = (async (strings: TemplateStringsArray) => {
      const text = strings.join(" ");
      if (text.includes("pgmq.read")) return batch;
      if (text.includes("from public.call_logs where id")) return [{ tenant_id: "t1" }];
      return [];
    }) as SqlClient;
    const deps: RecordingFetchDeps = {
      retellFetch: (() => Promise.resolve(new Response("{}", { status: 200 }))) as never,
      retellApiKey: "key",
      uploadToStorage: async () => ({ ok: true }),
      fetchRecordingBytes: async () => new ArrayBuffer(8),
    };

    const result = await runRecordingFetchWorker(sql, deps, makeLogger());

    expect(result.row_outcomes).toEqual([
      { msg_id: 5, call_id: "cl_x", outcome: "retried", reason: "not_ready" },
    ]);
  });

  it("omits row_outcomes entirely when every row was stored", async () => {
    const batch = [batchRow({ msgId: 1, callId: "cl_a", retellCallId: "call_a", attempt: 0 })];
    const sql = (async (strings: TemplateStringsArray) => {
      const text = strings.join(" ");
      if (text.includes("pgmq.read")) return batch;
      if (text.includes("from public.call_logs where id")) return [{ tenant_id: "t1" }];
      return [];
    }) as SqlClient;
    const deps: RecordingFetchDeps = {
      retellFetch: (() =>
        Promise.resolve(
          new Response(JSON.stringify({ recording_url: "https://retell/mono.wav" }), {
            status: 200,
          }),
        )) as never,
      retellApiKey: "key",
      uploadToStorage: async () => ({ ok: true }),
      fetchRecordingBytes: async () => new ArrayBuffer(8),
    };

    const result = await runRecordingFetchWorker(sql, deps, makeLogger());

    expect(result.stored).toBe(1);
    expect(result.row_outcomes).toBeUndefined();
  });

  it("deletes (never retries/dead-letters) a message whose call_logs row no longer exists", async () => {
    const batch = [
      batchRow({ msgId: 9, callId: "cl_gone", retellCallId: "call_gone", attempt: 0 }),
    ];
    const calls: { text: string; values: unknown[] }[] = [];
    const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      calls.push({ text, values });
      if (text.includes("pgmq.read")) return batch;
      if (text.includes("from public.call_logs where id")) return [];
      return [];
    }) as SqlClient;
    const deps: RecordingFetchDeps = {
      retellFetch: (() => Promise.resolve(new Response("{}", { status: 200 }))) as never,
      retellApiKey: "key",
      uploadToStorage: async () => ({ ok: true }),
      fetchRecordingBytes: async () => new ArrayBuffer(8),
    };

    const result = await runRecordingFetchWorker(sql, deps, makeLogger());

    expect(result.stored).toBe(0);
    expect(result.retried).toBe(0);
    expect(result.dead_lettered).toBe(0);
    expect(calls.some((c) => c.text.includes("pgmq.delete"))).toBe(true);
  });

  it("never crashes the batch even when the retry/dead-letter write itself throws", async () => {
    const batch = [
      batchRow({ msgId: 1, callId: "cl_a", retellCallId: "call_a", attempt: 0 }),
      batchRow({ msgId: 2, callId: "cl_b", retellCallId: "call_b", attempt: 0 }),
    ];
    const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("pgmq.read")) return batch;
      if (text.includes("from public.call_logs where id")) {
        if (values[0] === "cl_a") return [{ tenant_id: "t1" }];
        return [{ tenant_id: "t2" }];
      }
      // Row a's not_ready outcome tries to delete+re-enqueue; make the
      // delete itself throw to simulate a transient DB blip mid-retry.
      if (text.includes("pgmq.delete") && values[1] === 1) {
        throw new Error("db_blip");
      }
      return [];
    }) as SqlClient;
    const deps: RecordingFetchDeps = {
      retellFetch: (() =>
        Promise.resolve(
          new Response(JSON.stringify({ recording_url: "https://retell/mono.wav" }), {
            status: 200,
          }),
        )) as never,
      retellApiKey: "key",
      uploadToStorage: async () => ({ ok: true }),
      fetchRecordingBytes: async () => new ArrayBuffer(8),
    };
    // Row a is forced to fail so its retry write path (which throws) runs.
    const failingRetellFetch = ((url: string) =>
      url.includes("call_a")
        ? Promise.resolve(new Response("{}", { status: 200 }))
        : Promise.resolve(
            new Response(JSON.stringify({ recording_url: "https://retell/mono.wav" }), {
              status: 200,
            }),
          )) as never;

    const result = await runRecordingFetchWorker(
      sql,
      { ...deps, retellFetch: failingRetellFetch },
      makeLogger(),
    );

    // Row a's own retry write failed and was logged (not thrown out of the
    // loop); row b still got processed and stored.
    expect(result.stored).toBe(1);
    expect(result.batch_size).toBe(2);
  });
});
