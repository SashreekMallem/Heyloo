import { describe, expect, it, vi } from "vitest";
import type { SqlClient } from "../_shared/types.ts";
import type { WorkerTickDeps, WorkerTickRunners } from "./handler.ts";
import { notConfigured, runWorkerTick } from "./handler.ts";

// This dispatcher's own tests exercise concurrency/timeout/aggregation
// logic only — each underlying worker's business logic already has its
// own handler.test.ts (worker-messages-outbound, worker-recording-fetch,
// worker-adapter-push), so runners are injected fakes here, never the real
// implementations.

const fakeSql = (() => Promise.resolve([])) as unknown as SqlClient;

function makeDeps(overrides: Partial<WorkerTickDeps> = {}): WorkerTickDeps {
  return {
    outbound: {} as WorkerTickDeps["outbound"],
    recordingFetch: {
      deps: {} as never,
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as never,
    },
    adapterPush: {
      deps: {} as never,
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as never,
    },
    ...overrides,
  };
}

function delay<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

describe("runWorkerTick", () => {
  it("runs all three workers concurrently and reports each as ok", async () => {
    const runners: WorkerTickRunners = {
      outbound: vi.fn().mockResolvedValue({ processed: 2, dead_lettered: 0, batch_size: 2 }),
      recordingFetch: vi.fn().mockResolvedValue({
        stored: 1,
        retried: 0,
        dead_lettered: 0,
        batch_size: 1,
        retry_delay_seconds: 60,
      }),
      adapterPush: vi.fn().mockResolvedValue({ pushed: 3, dead_lettered: 0, batch_size: 3 }),
    };

    const result = await runWorkerTick(fakeSql, makeDeps(), runners);

    expect(result.messages_outbound).toEqual({
      status: "ok",
      result: { processed: 2, dead_lettered: 0, batch_size: 2 },
    });
    expect(result.recording_fetch.status).toBe("ok");
    expect(result.adapter_push.status).toBe("ok");
    expect(runners.outbound).toHaveBeenCalledTimes(1);
    expect(runners.recordingFetch).toHaveBeenCalledTimes(1);
    expect(runners.adapterPush).toHaveBeenCalledTimes(1);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("keeps one worker's failure from affecting the others' results", async () => {
    const runners: WorkerTickRunners = {
      outbound: vi.fn().mockRejectedValue(new Error("db_error")),
      recordingFetch: vi.fn().mockResolvedValue({
        stored: 0,
        retried: 0,
        dead_lettered: 0,
        batch_size: 0,
        retry_delay_seconds: 60,
      }),
      adapterPush: vi.fn().mockResolvedValue({ pushed: 0, dead_lettered: 0, batch_size: 0 }),
    };

    const result = await runWorkerTick(fakeSql, makeDeps(), runners);

    expect(result.messages_outbound).toEqual({ status: "error", error: "db_error" });
    expect(result.recording_fetch.status).toBe("ok");
    expect(result.adapter_push.status).toBe("ok");
  });

  it("times out a worker that runs past its own deadline without blocking the others", async () => {
    const runners: WorkerTickRunners = {
      outbound: vi
        .fn()
        .mockReturnValue(delay({ processed: 0, dead_lettered: 0, batch_size: 0 }, 200)),
      recordingFetch: vi.fn().mockResolvedValue({
        stored: 5,
        retried: 0,
        dead_lettered: 0,
        batch_size: 5,
        retry_delay_seconds: 60,
      }),
      adapterPush: vi.fn().mockResolvedValue({ pushed: 0, dead_lettered: 0, batch_size: 0 }),
    };

    const result = await runWorkerTick(fakeSql, makeDeps({ perWorkerTimeoutMs: 20 }), runners);

    expect(result.messages_outbound.status).toBe("timeout");
    if (result.messages_outbound.status === "timeout") {
      expect(result.messages_outbound.error).toBe("worker_tick_timeout:messages_outbound");
    }
    expect(result.recording_fetch).toEqual({
      status: "ok",
      result: { stored: 5, retried: 0, dead_lettered: 0, batch_size: 5, retry_delay_seconds: 60 },
    });
  });

  it("defaults perWorkerTimeoutMs to a value comfortably under a 15s net.http_post budget", async () => {
    const runners: WorkerTickRunners = {
      outbound: vi.fn().mockResolvedValue({ processed: 0, dead_lettered: 0, batch_size: 0 }),
      recordingFetch: vi.fn().mockResolvedValue({
        stored: 0,
        retried: 0,
        dead_lettered: 0,
        batch_size: 0,
        retry_delay_seconds: 60,
      }),
      adapterPush: vi.fn().mockResolvedValue({ pushed: 0, dead_lettered: 0, batch_size: 0 }),
    };

    const result = await runWorkerTick(fakeSql, makeDeps(), runners);
    expect(result.messages_outbound.status).toBe("ok");
  });

  it("skips a leg whose deps are NotConfiguredLeg without calling its runner, and still runs the other two", async () => {
    const runners: WorkerTickRunners = {
      outbound: vi.fn().mockResolvedValue({ processed: 9, dead_lettered: 0, batch_size: 9 }),
      recordingFetch: vi.fn().mockResolvedValue({
        stored: 0,
        retried: 0,
        dead_lettered: 0,
        batch_size: 0,
        retry_delay_seconds: 60,
      }),
      adapterPush: vi.fn().mockResolvedValue({ pushed: 0, dead_lettered: 0, batch_size: 0 }),
    };

    const result = await runWorkerTick(
      fakeSql,
      makeDeps({
        recordingFetch: notConfigured(["RETELL_API_KEY"]),
      }),
      runners,
    );

    expect(result.recording_fetch).toEqual({ status: "skipped", missing: ["RETELL_API_KEY"] });
    expect(runners.recordingFetch).not.toHaveBeenCalled();
    // The other two legs still ran normally — a missing secret for one leg
    // never crashes/skips the other two (OPS-3's own live-deploy finding).
    expect(result.messages_outbound).toEqual({
      status: "ok",
      result: { processed: 9, dead_lettered: 0, batch_size: 9 },
    });
    expect(result.adapter_push.status).toBe("ok");
    expect(runners.outbound).toHaveBeenCalledTimes(1);
    expect(runners.adapterPush).toHaveBeenCalledTimes(1);
  });

  it("skips all three legs independently when none are configured", async () => {
    const runners: WorkerTickRunners = {
      outbound: vi.fn(),
      recordingFetch: vi.fn(),
      adapterPush: vi.fn(),
    };

    const result = await runWorkerTick(
      fakeSql,
      {
        outbound: notConfigured(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]),
        recordingFetch: notConfigured(["RETELL_API_KEY"]),
        adapterPush: notConfigured(["ADAPTER_TOKEN_ENCRYPTION_KEY"]),
      },
      runners,
    );

    // messages_outbound's skip also carries `parked` (deliverable 2, OPS-8)
    // — the not-configured stale-message sweep's own result, always run
    // (never just "skip and do nothing") for THIS specific leg only.
    expect(result.messages_outbound).toEqual({
      status: "skipped",
      missing: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
      parked: { dead_lettered: 0 },
    });
    expect(result.recording_fetch).toEqual({ status: "skipped", missing: ["RETELL_API_KEY"] });
    expect(result.adapter_push).toEqual({
      status: "skipped",
      missing: ["ADAPTER_TOKEN_ENCRYPTION_KEY"],
    });
    expect(runners.outbound).not.toHaveBeenCalled();
    expect(runners.recordingFetch).not.toHaveBeenCalled();
    expect(runners.adapterPush).not.toHaveBeenCalled();
  });

  // OPS-8 deliverable 3: every tick's response reports per-queue backlog so
  // the nightly regression and admin pages can see it without a separate
  // DB read.
  it("includes pgmq.metrics_all()'s rows as `queues` in its response", async () => {
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
    const sql = (async (strings: TemplateStringsArray) => {
      const text = strings.join(" ");
      if (text.includes("pgmq.metrics_all")) return rows;
      return [];
    }) as unknown as SqlClient;
    const runners: WorkerTickRunners = {
      outbound: vi.fn().mockResolvedValue({ processed: 0, dead_lettered: 0, batch_size: 0 }),
      recordingFetch: vi.fn().mockResolvedValue({
        stored: 0,
        retried: 0,
        dead_lettered: 0,
        batch_size: 0,
        retry_delay_seconds: 60,
      }),
      adapterPush: vi.fn().mockResolvedValue({ pushed: 0, dead_lettered: 0, batch_size: 0 }),
    };

    const result = await runWorkerTick(sql, makeDeps(), runners);

    expect(result.queues).toEqual(rows);
  });

  it("never lets a metrics_all() failure fail the whole tick — queues comes back empty instead", async () => {
    const sql = (async (strings: TemplateStringsArray) => {
      const text = strings.join(" ");
      if (text.includes("pgmq.metrics_all")) throw new Error("db_error");
      return [];
    }) as unknown as SqlClient;
    const runners: WorkerTickRunners = {
      outbound: vi.fn().mockResolvedValue({ processed: 0, dead_lettered: 0, batch_size: 0 }),
      recordingFetch: vi.fn().mockResolvedValue({
        stored: 0,
        retried: 0,
        dead_lettered: 0,
        batch_size: 0,
        retry_delay_seconds: 60,
      }),
      adapterPush: vi.fn().mockResolvedValue({ pushed: 0, dead_lettered: 0, batch_size: 0 }),
    };

    const result = await runWorkerTick(sql, makeDeps(), runners);

    expect(result.queues).toEqual([]);
    expect(result.messages_outbound.status).toBe("ok");
  });

  it("dead-letters stale-enough parked messages via the sweep when the outbound leg is not configured", async () => {
    const staleMessage = { msg_id: 1, message: { message_id: "m1" } };
    const calls: string[] = [];
    const sql = (async (strings: TemplateStringsArray) => {
      const text = strings.join(" ");
      calls.push(text);
      if (text.includes("pgmq.q_messages_outbound_queue")) return [staleMessage];
      return [];
    }) as unknown as SqlClient;
    const runners: WorkerTickRunners = {
      outbound: vi.fn(),
      recordingFetch: vi.fn().mockResolvedValue({
        stored: 0,
        retried: 0,
        dead_lettered: 0,
        batch_size: 0,
        retry_delay_seconds: 60,
      }),
      adapterPush: vi.fn().mockResolvedValue({ pushed: 0, dead_lettered: 0, batch_size: 0 }),
    };

    const result = await runWorkerTick(
      sql,
      makeDeps({ outbound: notConfigured(["TWILIO_ACCOUNT_SID"]) }),
      runners,
    );

    expect(result.messages_outbound).toEqual({
      status: "skipped",
      missing: ["TWILIO_ACCOUNT_SID"],
      parked: { dead_lettered: 1 },
    });
    expect(runners.outbound).not.toHaveBeenCalled();
    expect(calls.some((t) => t.includes("pgmq.send"))).toBe(true); // the DLQ move itself ran
  });
});
