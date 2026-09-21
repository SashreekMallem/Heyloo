import { metricsAll, type QueueMetricsRow } from "../_shared/queue.ts";
import { withTimeout } from "../_shared/timeout.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";
import type {
  AdapterPushDeps,
  RunAdapterPushWorkerResult,
} from "../worker-adapter-push/handler.ts";
import { runAdapterPushWorker } from "../worker-adapter-push/handler.ts";
import type {
  OutboundDeps,
  RunOutboundWorkerResult,
  SweepNotConfiguredOutboundResult,
} from "../worker-messages-outbound/handler.ts";
import {
  runOutboundWorker,
  sweepNotConfiguredOutbound,
} from "../worker-messages-outbound/handler.ts";
import type {
  RecordingFetchDeps,
  RunRecordingFetchWorkerResult,
} from "../worker-recording-fetch/handler.ts";
import { runRecordingFetchWorker } from "../worker-recording-fetch/handler.ts";

/**
 * OPS-3 (docs/BUILD_NOTES.md) — single combined-dispatch worker, replacing
 * three separate `* * * * *` pg_cron -> pg_net.http_post jobs (worker-
 * messages-outbound, worker-recording-fetch, worker-adapter-push) that all
 * fired at the same wall-clock minute against the same host.
 *
 * ROOT CAUSE (measured live, OPS-3 experiment log, full detail in
 * docs/BUILD_NOTES.md's OPS-3 entry): OPS-2 had already measured a stable
 * PER-JOB asymmetry (worker-recording-fetch ~100% edge arrival,
 * worker-adapter-push ~68%, worker-messages-outbound ~50%) but left it
 * unexplained. A live experiment swapped the `net.http_post` target URL
 * between the best- and worst-arrival cron jobs for 9+ minutes: the loss
 * FOLLOWED THE TARGET URL/FUNCTION (worker-messages-outbound), not the
 * cron job or its dispatch slot — whichever job pointed at
 * worker-messages-outbound lost the majority of its requests, and
 * whichever job pointed elsewhere arrived ~100%, regardless of which job
 * it was. This rules out a pure job-dispatch-order/starvation
 * explanation. Combined with pg_net's own source
 * (github.com/supabase/pg_net `src/worker.c`: ONE persistent background
 * worker, ONE persistent `curl_multi_init()` handle shared across every
 * request the worker ever issues, no per-host connection cap and no HTTP
 * version override set) and libcurl's own documented default (HTTP/2
 * multiplexing — `CURLPIPE_MULTIPLEX` — has been ON by default since curl
 * 7.62.0, and it multiplexes concurrent transfers to the SAME host over
 * one shared connection when they're added to the same multi handle,
 * curl.se/libcurl/c/CURLMOPT_PIPELINING.html), the most evidence-backed
 * reading is: three concurrent same-tick, same-host requests are likely
 * multiplexed onto ONE shared TCP/TLS connection by pg_net's single
 * persistent worker, and worker-messages-outbound's specific endpoint
 * being disproportionately slow to respond can starve or coincide with
 * lost responses for the OTHER streams sharing that connection too — the
 * exact final-mile reason that ONE endpoint is the slow one was not
 * independently confirmed against Supabase's own infra from this
 * environment and is logged as a docs/VERIFY.md gap, not guessed at
 * further (CLAUDE.md Rule 1). curl/curl#18216 (a DNS-timeout leaving
 * pg_net's shared c-ares channel stuck until the worker restarts, cited
 * by OPS-2) remains a plausible compounding factor for the *chronic*
 * floor, but the swap experiment shows it is not the whole story on its
 * own. One request per minute removes the shared-connection contention
 * these three concurrent requests created, regardless of which exact
 * final-mile mechanism inside it is responsible — a strictly stronger fix
 * than only restarting the worker after the fact (OPS-2's
 * `net.worker_restart()`, kept as a defense-in-depth backstop for the
 * resolver-corruption failure mode, not superseded here).
 *
 * This function invokes each worker's own `run*Worker` batch-poll entry
 * point (moved into each function's own portable `handler.ts` in this same
 * task) in-process, concurrently, each under its own hard timeout so one
 * slow/stuck queue never starves the other two within the shared
 * `net.http_post` budget. Each function's own `index.ts` endpoint is left
 * intact and independently invocable (manual ops runs, local dev) — this
 * is an additional caller, not a replacement implementation.
 *
 * NOT_CONFIGURED isolation (OPS-3 live-deploy finding): before this
 * consolidation, each of the three workers was its own function with its
 * own module-scope `requireEnv` calls — one worker's missing integration
 * secret (e.g. worker-messages-outbound's Twilio/Resend, unprovisioned on
 * this project as of OPS-3) crashed *that function* at cold start but
 * never touched the other two, which kept polling their own queues
 * successfully. Naively combining all three into one function would
 * silently regress that: ANY of the three legs' required secrets being
 * absent would crash `worker-tick`'s entire cold start, taking every
 * queue's polling down with it. `index.ts` checks each leg's required env
 * vars itself (via `missingEnv`, the OPS-1 pattern) and passes
 * `NOT_CONFIGURED` for a leg with something missing instead of building
 * its deps — `runWorkerTick` below skips exactly that leg (never calling
 * its runner, matching CLAUDE.md Rule 2's "missing secret = reject, never
 * skip THE CHECK" — it is the leg's *invocation* that is skipped, not the
 * secret requirement) while the other two legs still run normally.
 */

export const NOT_CONFIGURED = Symbol("worker-tick leg not configured");

export interface NotConfiguredLeg {
  readonly marker: typeof NOT_CONFIGURED;
  readonly missing: readonly string[];
}

export function notConfigured(missing: readonly string[]): NotConfiguredLeg {
  return { marker: NOT_CONFIGURED, missing };
}

function isNotConfigured(x: unknown): x is NotConfiguredLeg {
  return (
    typeof x === "object" && x !== null && (x as { marker?: unknown }).marker === NOT_CONFIGURED
  );
}

export interface WorkerTickDeps {
  outbound: OutboundDeps | NotConfiguredLeg;
  recordingFetch: { deps: RecordingFetchDeps; logger: Logger } | NotConfiguredLeg;
  adapterPush: { deps: AdapterPushDeps; logger: Logger } | NotConfiguredLeg;
  /** Hard per-worker deadline (ms). Defaults to 12s so three workers run
   * concurrently comfortably inside the 15s `net.http_post`
   * `timeout_milliseconds` budget the calling cron job uses. */
  perWorkerTimeoutMs?: number;
}

/** Real implementations by default; overridable so this dispatcher's own
 * tests exercise its concurrency/timeout/aggregation logic without needing
 * full DB fixtures for all three underlying workers (each already has its
 * own handler.test.ts covering its business logic). */
export interface WorkerTickRunners {
  outbound: (sql: SqlClient, deps: OutboundDeps) => Promise<RunOutboundWorkerResult>;
  recordingFetch: (
    sql: SqlClient,
    deps: RecordingFetchDeps,
    logger: Logger,
  ) => Promise<RunRecordingFetchWorkerResult>;
  adapterPush: (
    sql: SqlClient,
    logger: Logger,
    deps: AdapterPushDeps,
  ) => Promise<RunAdapterPushWorkerResult>;
}

export const DEFAULT_WORKER_TICK_RUNNERS: WorkerTickRunners = {
  outbound: runOutboundWorker,
  recordingFetch: runRecordingFetchWorker,
  adapterPush: runAdapterPushWorker,
};

export type WorkerOutcome<T> =
  | { status: "ok"; result: T }
  | { status: "timeout"; error: string }
  | { status: "error"; error: string }
  | {
      status: "skipped";
      missing: readonly string[];
      /** Only ever set for the `messages_outbound` leg (OPS-8, deliverable
       * 2) — the not-configured stale-message sweep's own result, present
       * whenever the sweep itself ran without throwing. */
      parked?: SweepNotConfiguredOutboundResult;
    };

export interface WorkerTickResult {
  messages_outbound: WorkerOutcome<RunOutboundWorkerResult>;
  recording_fetch: WorkerOutcome<RunRecordingFetchWorkerResult>;
  adapter_push: WorkerOutcome<RunAdapterPushWorkerResult>;
  /** Every queue's `pgmq.metrics_all()` row (OPS-8, deliverable 3) — so the
   * nightly regression and admin pages can see backlog/DLQ depth straight
   * from this response, without a separate DB read. Empty (never throws
   * out of the whole tick) if the metrics read itself fails. */
  queues: QueueMetricsRow[];
  duration_ms: number;
}

const DEFAULT_PER_WORKER_TIMEOUT_MS = 12_000;

function settle<T>(settled: PromiseSettledResult<T>): WorkerOutcome<T> {
  if (settled.status === "fulfilled") {
    return { status: "ok", result: settled.value };
  }
  const message = settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
  return {
    status: message.startsWith("worker_tick_timeout:") ? "timeout" : "error",
    error: message,
  };
}

/** Runs one leg: an immediate `skipped` outcome if its deps are
 * `NotConfiguredLeg` (the runner is never called — no partial/undefined
 * secret ever reaches it), otherwise the runner under `withTimeout`. Never
 * rejects — every leg resolves to a `WorkerOutcome`, so the three legs can
 * be run with a plain `Promise.all` and still never let one leg's
 * rejection affect another's result. */
async function runLeg<D, T>(
  legDeps: D | NotConfiguredLeg,
  run: (deps: D) => Promise<T>,
  timeoutMs: number,
  timeoutTag: string,
): Promise<WorkerOutcome<T>> {
  if (isNotConfigured(legDeps)) {
    return { status: "skipped", missing: legDeps.missing };
  }
  const settled = await Promise.allSettled([
    withTimeout(run(legDeps), timeoutMs, () => new Error(`worker_tick_timeout:${timeoutTag}`)),
  ]);
  return settle(settled[0] as PromiseSettledResult<T>);
}

/** The `messages_outbound` leg's own NotConfigured handling (deliverable 2,
 * OPS-8): unlike `runLeg`'s generic "just report skipped, touch nothing"
 * behavior (still exactly what the OTHER two legs do when not configured —
 * neither recording_fetch nor adapter_push has a "provider absent, park
 * honestly" requirement in this task's brief), a not-configured outbound
 * leg still runs the bounded, read_ct-free stale sweep so old-enough
 * messages get a visible, honest dead-letter instead of waiting forever
 * with zero signal. The sweep itself never throws out of this function —
 * a failure there is logged as a normal `skipped` outcome with no `parked`
 * field, never escalated into a tick-wide failure. */
async function runOutboundLeg(
  sql: SqlClient,
  legDeps: OutboundDeps | NotConfiguredLeg,
  run: (deps: OutboundDeps) => Promise<RunOutboundWorkerResult>,
  timeoutMs: number,
): Promise<WorkerOutcome<RunOutboundWorkerResult>> {
  if (isNotConfigured(legDeps)) {
    const parked = await sweepNotConfiguredOutbound(sql).catch(() => undefined);
    return { status: "skipped", missing: legDeps.missing, ...(parked ? { parked } : {}) };
  }
  return runLeg(legDeps, run, timeoutMs, "messages_outbound");
}

export async function runWorkerTick(
  sql: SqlClient,
  deps: WorkerTickDeps,
  runners: WorkerTickRunners = DEFAULT_WORKER_TICK_RUNNERS,
): Promise<WorkerTickResult> {
  const timeoutMs = deps.perWorkerTimeoutMs ?? DEFAULT_PER_WORKER_TIMEOUT_MS;
  const startedAt = Date.now();

  const [messagesOutbound, recordingFetchOutcome, adapterPushOutcome, queues] = await Promise.all([
    runOutboundLeg(sql, deps.outbound, (d) => runners.outbound(sql, d), timeoutMs),
    runLeg(
      deps.recordingFetch,
      (d) => runners.recordingFetch(sql, d.deps, d.logger),
      timeoutMs,
      "recording_fetch",
    ),
    runLeg(
      deps.adapterPush,
      (d) => runners.adapterPush(sql, d.logger, d.deps),
      timeoutMs,
      "adapter_push",
    ),
    metricsAll(sql).catch(() => []),
  ]);

  return {
    messages_outbound: messagesOutbound,
    recording_fetch: recordingFetchOutcome,
    adapter_push: adapterPushOutcome,
    queues,
    duration_ms: Date.now() - startedAt,
  };
}
