// Deno-only glue (excluded from ../../tsconfig.json). Wraps
// `EdgeRuntime.waitUntil` — Supabase's documented mechanism for running
// work after a response has been returned (BACKEND_SPEC §7.3: "verify →
// dedup → fast-ack → background: ... via `pg_net` async call ... or
// `EdgeRuntime.waitUntil` per Supabase's documented background-task
// pattern"). VERIFY (docs/VERIFY.md): confirm current signature/limits
// (paid-plan 400s cap, free 150s — per public docs summarized in
// docs/VERIFY.md since supabase.com was egress-blocked in this build) before
// relying on it for anything long-running; the recording-fetch path in
// particular already has its own queue-based retry budget independent of
// this cap.
//
// Falls back to a plain fire-and-forget promise (with a logged rejection
// handler) if `EdgeRuntime` isn't present in a given runtime — keeps every
// handler's background-task call site identical whether or not the global
// exists.
export function runInBackground(task: () => Promise<void>, onError: (err: unknown) => void): void {
  const wrapped = task().catch(onError);
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime;
  if (rt?.waitUntil) {
    rt.waitUntil(wrapped);
  }
  // If EdgeRuntime isn't present, `wrapped` still runs — the instance simply
  // isn't guaranteed to stay alive for it if the platform tears the isolate
  // down instantly after response flush, which is why every background path
  // in this codebase treats loss-of-background-work as a recoverable case
  // (webhook redelivery, queue redelivery, nightly reconciliation) rather
  // than a source of truth in itself (SYSTEM_DESIGN §8).
}
