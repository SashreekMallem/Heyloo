import { enqueueOwnerAlertBestEffort } from "../_shared/owner-alerts.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";
import type { CallContext } from "./context.ts";

/**
 * VOICE-ALERTS-1: how a voice tool raises an owner alert without touching
 * its own latency. `defer` is `EdgeRuntime.waitUntil`-backed in
 * `voice-tools/index.ts` (the alert then runs after the caller-facing
 * result is sent); when a caller has none (the text agent, unit tests) the
 * alert is awaited inline. Either way it is best-effort: an alert failure
 * is logged and never becomes a tool failure, and a test call never alerts
 * (`enqueueOwnerAlertBestEffort`).
 *
 * Cost per alert: `loadOwnerAlertContact` (1 select) + the idempotent
 * insert (1) + `pgmq.send` (1). Three statements, all off the response path
 * on the deployed hot path.
 */
export interface OwnerAlertDeps {
  logger: Logger;
  defer?: ((label: string, task: () => Promise<void>) => void) | undefined;
}

export type OwnerAlertInput = Parameters<typeof enqueueOwnerAlertBestEffort>[3];

export async function raiseOwnerAlert(
  sql: SqlClient,
  ctx: CallContext,
  deps: OwnerAlertDeps,
  label: string,
  input: OwnerAlertInput,
): Promise<void> {
  const run = async (): Promise<void> => {
    await enqueueOwnerAlertBestEffort(sql, deps.logger, ctx, input);
  };
  if (deps.defer) {
    deps.defer(label, run);
    return;
  }
  await run();
}
