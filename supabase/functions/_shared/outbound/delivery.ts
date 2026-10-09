import { enqueueOwnerAlert } from "../owner-alerts.ts";
import { type DnsResolver, JSON_API_CONTENT_TYPES, safeFetch } from "../safe-fetch.ts";
import {
  OUTBOUND_TEST_EVENT_TYPE,
  type OutboundAnyEventType,
  type OutboundEntityType,
} from "../schemas/outbound-webhooks.ts";
import { signStandardWebhook } from "../standard-webhooks.ts";
import type { Logger, SqlClient } from "../types.ts";
import { buildOutboundPayload, OutboundPayloadInvalidError } from "./payload.ts";
import {
  type AttemptOutcome,
  classifyError,
  classifyResponse,
  nextRetryDelaySeconds,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_REQUEST_TIMEOUT_MS,
} from "./policy.ts";

/**
 * OUTBOUND-1 delivery engine: claims due `outbound_deliveries` rows, builds
 * (once) and signs the Standard Webhooks request, POSTs it through the
 * SSRF-safe fetch, and records the outcome (delivered / retry with backoff /
 * failed / destination auto-disabled on 410 / owner alert). Runs as the
 * `outbound_webhooks` leg of `worker-tick` (every minute) and, for "Send
 * test", in-request from `api-tenant-webhooks` with the same code.
 *
 * Concurrency safety: a delivery is leased (`status = 'sending'`,
 * `locked_until = now() + 2 min`, `attempt_count + 1`) in ONE statement with
 * `for update skip locked`, so two overlapping ticks never send the same
 * attempt. Every outcome write is guarded by `status = 'sending' and
 * attempt_count = <the leased attempt>`, so a worker whose lease expired and
 * was re-claimed can never overwrite the newer attempt's result. A crash
 * mid-send leaves the row `sending`; the next tick after `locked_until`
 * re-claims it (that attempt counts) while attempts are left, and
 * `failAbandonedDeliveries` fails it (with the owner alert) once none are
 * (attempt 8, or any test ping, which is a single attempt). A row whose
 * processing throws is recorded like a failed attempt (backoff, final
 * attempt fails), so it can never cycle forever. Receivers dedupe on
 * `webhook-id` (constant per event across retries and destinations).
 *
 * Throughput: the worker-tick leg claims and sends batches of 10 in rounds
 * until a claim comes back short or the round deadline passes (5.5 s, so a
 * last round of 5 s timeouts still ends inside the 12 s leg budget), and
 * reports the remaining due backlog when it stops on a full batch.
 *
 * Secrets: the signing secret is read from Vault inside the claim statement
 * (`fn_outbound_secret_read`, service role only) and lives only in memory
 * for the send; it is never logged or returned.
 */

export const WEBHOOK_BATCH_SIZE = 10;
export const WEBHOOK_CONCURRENCY = 10;
export const WEBHOOK_USER_AGENT = "Heyloo-Webhooks/1";
/** A new claim round starts only this soon after the leg began: one more
 * round (5 s request timeout + its DB writes) still ends inside worker-tick's
 * 12 s per-leg deadline. */
export const WEBHOOK_ROUND_START_DEADLINE_MS = 5_500;
/** Hard cap on claim rounds per leg run (at most 200 deliveries a tick). */
export const WEBHOOK_MAX_ROUNDS = 20;
/** Expired leases with no attempt left that one leg run fails. */
export const WEBHOOK_ABANDONED_SWEEP_LIMIT = 50;
/** The backlog count stops here (it is a health signal, not an exact figure). */
export const WEBHOOK_BACKLOG_COUNT_CAP = 10_000;

/** Owner-safe `last_error` for a lease that ran out on its last allowed attempt. */
export const ABANDONED_DELIVERY_ERROR = "Heyloo couldn't finish sending this event";
/** Owner-safe `last_error` when processing a delivery hit an internal error. */
export const PROCESSING_ERROR = "Heyloo had a problem sending this event";

export interface WebhookDeliveryDeps {
  /** `APP_BASE_URL`, for the payload's `dashboard_url`. */
  appBaseUrl: string;
  logger: Logger;
  /** HTTP transport UNDER safe-fetch (default: global `fetch`). safe-fetch
   * validates every URL (public https host, port 443, DNS answers public)
   * before this is ever called, so it is never handed an unchecked URL. */
  transport?: typeof fetch;
  /** DNS resolver for safe-fetch (default: `Deno.resolveDns` when present). */
  resolver?: DnsResolver | null;
  now?: () => Date;
  random?: () => number;
  batchSize?: number;
  concurrency?: number;
  timeoutMs?: number;
  /** Override `WEBHOOK_ROUND_START_DEADLINE_MS` (tests). */
  roundStartDeadlineMs?: number;
  /** Override `WEBHOOK_MAX_ROUNDS` (tests). */
  maxRounds?: number;
}

/** A leased delivery joined to its destination and event. */
export interface ClaimedDelivery {
  id: string;
  tenant_id: string;
  destination_id: string;
  event_id: string;
  /** The attempt now in flight (already incremented by the claim). */
  attempt_count: number;
  url: string;
  destination_name: string;
  destination_enabled: boolean;
  /** Plaintext signing secret from Vault; null when the Vault row is gone. */
  secret: string | null;
  event_type: OutboundAnyEventType;
  entity_type: OutboundEntityType;
  entity_id: string | null;
  occurred_at: Date | string;
  payload: unknown;
}

export type DeliveryResult =
  | { status: "delivered"; statusCode: number }
  | { status: "retrying"; statusCode: number | null; error: string; delaySeconds: number }
  | { status: "failed"; statusCode: number | null; error: string; destinationDisabled: boolean }
  | {
      status: "cancelled";
      reason: "destination_disabled" | "entity_missing" | "lease_lost";
    };

export interface RunWebhookDeliveryResult {
  claimed: number;
  delivered: number;
  retrying: number;
  failed: number;
  cancelled: number;
  errors: number;
  /** Expired leases with no attempt left, failed by `failAbandonedDeliveries`. */
  abandoned: number;
  /** Claim rounds run this tick. */
  rounds: number;
  /** Deliveries still due when the leg stopped on a full batch (capped at
   * `WEBHOOK_BACKLOG_COUNT_CAP`); 0 when the last claim came back short. */
  backlog: number;
}

/** Standard Webhooks `webhook-id` for an event: constant across retries and destinations. */
export function webhookIdForEvent(eventId: string): string {
  return `evt_${eventId.replace(/-/g, "")}`;
}

const EVENT_PHRASES: Record<OutboundAnyEventType, string> = {
  "booking.created": "a new booking",
  "booking.updated": "a booking change",
  "booking.cancelled": "a booking cancellation",
  "order.created": "a new order",
  "order.updated": "an order status change",
  "order.cancelled": "an order cancellation",
  "message.taken": "a new message",
  "test.ping": "a test event",
};

// ---------------------------------------------------------------------------
// Claiming
// ---------------------------------------------------------------------------

/**
 * Leases up to `limit` due deliveries in one statement. An expired lease is
 * re-claimed (crash recovery) only while the policy allows another attempt:
 * fewer than `WEBHOOK_MAX_ATTEMPTS`, and never for a test ping (one attempt).
 * Those with none left are failed by `failAbandonedDeliveries` instead. An
 * owner's manual `retry` of a failed row goes through the `retrying` branch,
 * so it still gets its one extra attempt.
 */
export async function claimDueDeliveries(
  sql: SqlClient,
  limit: number = WEBHOOK_BATCH_SIZE,
): Promise<ClaimedDelivery[]> {
  return sql<ClaimedDelivery>`
    with due as (
      select od.id
      from public.outbound_deliveries od
      join public.outbound_events e on e.id = od.event_id and e.tenant_id = od.tenant_id
      where (od.status in ('pending', 'retrying') and od.next_attempt_at <= now())
         or (od.status = 'sending' and od.locked_until < now()
             and od.attempt_count < ${WEBHOOK_MAX_ATTEMPTS} and e.event_type <> 'test.ping')
      order by od.next_attempt_at
      limit ${limit}
      for update of od skip locked
    )
    update public.outbound_deliveries od
    set status = 'sending',
        locked_until = now() + interval '2 minutes',
        attempt_count = od.attempt_count + 1
    from due, public.outbound_destinations d, public.outbound_events e
    where od.id = due.id
      and d.id = od.destination_id and d.tenant_id = od.tenant_id
      and e.id = od.event_id and e.tenant_id = od.tenant_id
    returning od.id, od.tenant_id, od.destination_id, od.event_id, od.attempt_count,
      d.url, d.name as destination_name, d.enabled as destination_enabled,
      public.fn_outbound_secret_read(d.signing_secret_id) as secret,
      e.event_type, e.entity_type, e.entity_id, e.occurred_at, e.payload
  `;
}

/** Leases one specific pending delivery of `tenantId` ("Send test", in-request). */
export async function claimDeliveryById(
  sql: SqlClient,
  tenantId: string,
  deliveryId: string,
): Promise<ClaimedDelivery | null> {
  const rows = await sql<ClaimedDelivery>`
    update public.outbound_deliveries od
    set status = 'sending',
        locked_until = now() + interval '2 minutes',
        attempt_count = od.attempt_count + 1
    from public.outbound_destinations d, public.outbound_events e
    where od.id = ${deliveryId} and od.tenant_id = ${tenantId} and od.status = 'pending'
      and d.id = od.destination_id and d.tenant_id = od.tenant_id
      and e.id = od.event_id and e.tenant_id = od.tenant_id
    returning od.id, od.tenant_id, od.destination_id, od.event_id, od.attempt_count,
      d.url, d.name as destination_name, d.enabled as destination_enabled,
      public.fn_outbound_secret_read(d.signing_secret_id) as secret,
      e.event_type, e.entity_type, e.entity_id, e.occurred_at, e.payload
  `;
  return rows[0] ?? null;
}

/** A delivery `failAbandonedDeliveries` gave up on. */
export interface AbandonedDelivery {
  id: string;
  tenant_id: string;
  destination_id: string;
  attempt_count: number;
  event_type: OutboundAnyEventType;
}

/**
 * Fails expired leases that have no attempt left (the worker or the "Send
 * test" request died mid-attempt on attempt 8, or on a test ping), instead of
 * sending a 9th attempt or a second test ping, and alerts the owner (never
 * for a test ping; same 24 h throttle). Destination health is left alone:
 * the attempt never finished, so it says nothing about the receiver.
 */
export async function failAbandonedDeliveries(
  sql: SqlClient,
  logger: Logger,
  limit: number = WEBHOOK_ABANDONED_SWEEP_LIMIT,
): Promise<number> {
  const rows = await sql<AbandonedDelivery>`
    with stale as (
      select od.id
      from public.outbound_deliveries od
      join public.outbound_events e on e.id = od.event_id and e.tenant_id = od.tenant_id
      where od.status = 'sending' and od.locked_until < now()
        and (od.attempt_count >= ${WEBHOOK_MAX_ATTEMPTS} or e.event_type = 'test.ping')
      order by od.locked_until
      limit ${limit}
      for update of od skip locked
    )
    update public.outbound_deliveries od
    set status = 'failed', locked_until = null, last_error = ${ABANDONED_DELIVERY_ERROR}
    from stale, public.outbound_events e
    where od.id = stale.id
      and e.id = od.event_id and e.tenant_id = od.tenant_id
    returning od.id, od.tenant_id, od.destination_id, od.attempt_count, e.event_type
  `;
  for (const row of rows) {
    logger.warn("outbound_webhook_delivery_abandoned", {
      tenant_id: row.tenant_id,
      delivery_id: row.id,
      destination_id: row.destination_id,
      attempt: row.attempt_count,
    });
    await alertOwner(sql, row, false, logger);
  }
  return rows.length;
}

/** Deliveries due now (capped), for the backlog signal. */
export async function countDueDeliveries(
  sql: SqlClient,
  cap: number = WEBHOOK_BACKLOG_COUNT_CAP,
): Promise<number> {
  const rows = await sql<{ n: number }>`
    select count(*)::int as n from (
      select 1 from public.outbound_deliveries od
      where od.status in ('pending', 'retrying') and od.next_attempt_at <= now()
      limit ${cap}
    ) due
  `;
  return rows[0]?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Payload (built once per event, then byte-identical)
// ---------------------------------------------------------------------------

function serialize(payload: unknown): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

/**
 * The exact body to send: the stored payload when the event already has one,
 * else built from the current rows and stored (first writer wins; a
 * concurrent builder's stored value is re-read and used instead, so every
 * attempt of every destination sends the same bytes). Null when the entity
 * is gone.
 */
export async function ensurePayloadBody(
  sql: SqlClient,
  row: ClaimedDelivery,
  appBaseUrl: string,
): Promise<string | null> {
  if (row.payload !== null && row.payload !== undefined) return serialize(row.payload);

  const built = await buildOutboundPayload(
    sql,
    {
      id: row.event_id,
      tenant_id: row.tenant_id,
      event_type: row.event_type,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      occurred_at: row.occurred_at,
    },
    appBaseUrl,
  );
  if (built.status === "missing") return null;

  const stored = await sql<{ payload: unknown }>`
    update public.outbound_events
    set payload = ${built.payload}::jsonb
    where id = ${row.event_id} and tenant_id = ${row.tenant_id} and payload is null
    returning payload
  `;
  if (stored[0]?.payload) return serialize(stored[0].payload);

  const current = await sql<{ payload: unknown }>`
    select payload from public.outbound_events
    where id = ${row.event_id} and tenant_id = ${row.tenant_id}
  `;
  return current[0]?.payload ? serialize(current[0].payload) : null;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/**
 * Wraps the transport so the receiver's response BODY is never read: only
 * the status and the headers we act on (`location` for safe-fetch's redirect
 * check, `retry-after` for backoff) survive. A delivery's outcome depends on
 * the status alone, so an unusual content type or a large body from the
 * receiver can never turn a 2xx into a failure, and nothing the receiver
 * sends is buffered.
 */
function statusOnly(transport: typeof fetch): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const res = await transport(input, init);
    await res.body?.cancel().catch(() => undefined);
    const headers = new Headers({ "content-length": "0" });
    for (const name of ["location", "retry-after"]) {
      const value = res.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    return new Response(null, { status: res.status, statusText: res.statusText, headers });
  }) as typeof fetch;
}

/** One signed POST. Never throws: every failure is an `AttemptOutcome`. */
export async function sendSignedWebhook(
  params: { url: string; webhookId: string; body: string; secret: string },
  deps: Pick<WebhookDeliveryDeps, "transport" | "resolver" | "now" | "timeoutMs">,
): Promise<AttemptOutcome> {
  const now = deps.now ?? (() => new Date());
  const timeoutMs = deps.timeoutMs ?? WEBHOOK_REQUEST_TIMEOUT_MS;
  // The table's CHECK already guarantees https; safe-fetch alone would also
  // accept http, so never let a plaintext URL through here either.
  if (!params.url.startsWith("https://")) {
    return {
      kind: "retry",
      statusCode: null,
      error: "This address isn't allowed (it must be a public https:// address)",
      retryAfterSeconds: null,
    };
  }
  const timestampSeconds = Math.floor(now().getTime() / 1000);
  let signature: string;
  try {
    signature = await signStandardWebhook({
      secret: params.secret,
      id: params.webhookId,
      timestampSeconds,
      body: params.body,
    });
  } catch {
    return {
      kind: "retry",
      statusCode: null,
      error: "Signing secret missing",
      retryAfterSeconds: null,
    };
  }
  try {
    const res = await safeFetch(
      params.url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": WEBHOOK_USER_AGENT,
          "webhook-id": params.webhookId,
          "webhook-timestamp": String(timestampSeconds),
          "webhook-signature": signature,
        },
        body: params.body,
      },
      {
        // Required by safe-fetch; the status-only transport always hands it an empty body.
        allowedContentTypes: JSON_API_CONTENT_TYPES,
        timeoutMs,
        // Standard Webhooks: a 3xx is a failure; the owner should update the URL.
        maxRedirects: 0,
        fetchImpl: statusOnly(deps.transport ?? fetch),
        ...(deps.resolver !== undefined ? { resolver: deps.resolver } : {}),
      },
    );
    return classifyResponse(res.status, res.headers, now());
  } catch (err) {
    return classifyError(err, timeoutMs);
  }
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

async function markCancelled(sql: SqlClient, row: ClaimedDelivery, error: string): Promise<void> {
  await sql`
    update public.outbound_deliveries
    set status = 'cancelled', last_error = ${error}, locked_until = null
    where id = ${row.id} and tenant_id = ${row.tenant_id}
      and status = 'sending' and attempt_count = ${row.attempt_count}
  `;
}

/**
 * Timestamps here stay Postgres text end to end (`::text` out, `::text` in):
 * postgres.js would serialize a timestamptz parameter through a JS Date and
 * drop the microseconds, so the release's equality guard would never match.
 */
interface AlertClaim {
  name: string;
  /** `last_alerted_at` before this claim (text with its UTC offset), or null. */
  previous_alerted_at: string | null;
  /** The value this claim wrote, as text. */
  claimed_alerted_at: string;
}

/**
 * At most one owner alert per destination per 24 h (`last_alerted_at`). The
 * window is claimed first (one conditional UPDATE, so two workers can never
 * both alert); if the alert then cannot be queued, the claim is undone so the
 * next failure can still alert, unless a newer claim has replaced it since.
 */
async function alertOwner(
  sql: SqlClient,
  row: Pick<ClaimedDelivery, "tenant_id" | "destination_id" | "event_type">,
  disabled: boolean,
  logger: Logger,
): Promise<void> {
  if (row.event_type === OUTBOUND_TEST_EVENT_TYPE) return; // the owner is looking at the result
  let claim: AlertClaim | undefined;
  try {
    const claimed = await sql<AlertClaim>`
      update public.outbound_destinations d
      set last_alerted_at = now()
      from (
        select p.last_alerted_at::text as previous_alerted_at
        from public.outbound_destinations p
        where p.id = ${row.destination_id} and p.tenant_id = ${row.tenant_id}
      ) prev
      where d.id = ${row.destination_id} and d.tenant_id = ${row.tenant_id}
        and (d.last_alerted_at is null or d.last_alerted_at < now() - interval '24 hours')
      returning d.name, prev.previous_alerted_at, d.last_alerted_at::text as claimed_alerted_at
    `;
    claim = claimed[0];
    if (!claim) return;
    await enqueueOwnerAlert(sql, {
      tenantId: row.tenant_id,
      kind: "webhook_failing",
      payload: {
        destination_name: claim.name,
        event_type: row.event_type,
        event_label: EVENT_PHRASES[row.event_type],
        disabled,
      },
    });
  } catch (err) {
    logger.error("outbound_webhook_alert_failed", {
      tenant_id: row.tenant_id,
      destination_id: row.destination_id,
      error: err instanceof Error ? err.message : String(err),
    });
    if (claim) await releaseAlertClaim(sql, row, claim, logger);
  }
}

/** Gives a claimed-but-unsent alert window back (see `alertOwner`). */
async function releaseAlertClaim(
  sql: SqlClient,
  row: Pick<ClaimedDelivery, "tenant_id" | "destination_id">,
  claim: AlertClaim,
  logger: Logger,
): Promise<void> {
  try {
    await sql`
      update public.outbound_destinations
      set last_alerted_at = ${claim.previous_alerted_at}::text::timestamptz
      where id = ${row.destination_id} and tenant_id = ${row.tenant_id}
        and last_alerted_at::text = ${claim.claimed_alerted_at}::text
    `;
  } catch (err) {
    logger.error("outbound_webhook_alert_release_failed", {
      tenant_id: row.tenant_id,
      destination_id: row.destination_id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Writes an attempt's outcome to the delivery and the destination's health. */
export async function recordOutcome(
  sql: SqlClient,
  row: ClaimedDelivery,
  outcome: AttemptOutcome,
  deps: Pick<WebhookDeliveryDeps, "logger" | "random">,
): Promise<DeliveryResult> {
  if (outcome.kind === "delivered") {
    const updated = await sql<{ id: string }>`
      update public.outbound_deliveries
      set status = 'delivered', delivered_at = now(), last_status_code = ${outcome.statusCode},
          last_error = null, locked_until = null
      where id = ${row.id} and tenant_id = ${row.tenant_id}
        and status = 'sending' and attempt_count = ${row.attempt_count}
      returning id
    `;
    if (updated.length === 0) return { status: "cancelled", reason: "lease_lost" };
    await sql`
      update public.outbound_destinations
      set consecutive_failures = 0, last_success_at = now()
      where id = ${row.destination_id} and tenant_id = ${row.tenant_id}
    `;
    return { status: "delivered", statusCode: outcome.statusCode };
  }

  // Test pings are a single attempt: the owner sees the result right away.
  const delaySeconds =
    outcome.kind === "retry" && row.event_type !== OUTBOUND_TEST_EVENT_TYPE
      ? nextRetryDelaySeconds(row.attempt_count, outcome.retryAfterSeconds, deps.random)
      : null;
  const giveUp = delaySeconds === null;

  const updated = giveUp
    ? await sql<{ id: string }>`
        update public.outbound_deliveries
        set status = 'failed', last_status_code = ${outcome.statusCode}, last_error = ${outcome.error},
            locked_until = null
        where id = ${row.id} and tenant_id = ${row.tenant_id}
          and status = 'sending' and attempt_count = ${row.attempt_count}
        returning id
      `
    : await sql<{ id: string }>`
        update public.outbound_deliveries
        set status = 'retrying', next_attempt_at = now() + make_interval(secs => ${delaySeconds}),
            last_status_code = ${outcome.statusCode}, last_error = ${outcome.error},
            locked_until = null
        where id = ${row.id} and tenant_id = ${row.tenant_id}
          and status = 'sending' and attempt_count = ${row.attempt_count}
        returning id
      `;
  if (updated.length === 0) return { status: "cancelled", reason: "lease_lost" };

  const gone = outcome.kind === "gone";
  if (gone) {
    await sql`
      update public.outbound_destinations
      set enabled = false, disabled_reason = 'gone_410',
          consecutive_failures = consecutive_failures + 1,
          last_failure_at = now(), last_error = ${outcome.error}
      where id = ${row.destination_id} and tenant_id = ${row.tenant_id}
    `;
  } else {
    await sql`
      update public.outbound_destinations
      set consecutive_failures = consecutive_failures + 1,
          last_failure_at = now(), last_error = ${outcome.error}
      where id = ${row.destination_id} and tenant_id = ${row.tenant_id}
    `;
  }

  if (giveUp) {
    await alertOwner(sql, row, gone, deps.logger);
    return {
      status: "failed",
      statusCode: outcome.statusCode,
      error: outcome.error,
      destinationDisabled: gone,
    };
  }
  return {
    status: "retrying",
    statusCode: outcome.statusCode,
    error: outcome.error,
    delaySeconds,
  };
}

/** Builds/sends/records one leased delivery. Throws only on a database error.
 * `bodyFor` lets a batch share one build per event (default: build/read it). */
export async function processClaimedDelivery(
  sql: SqlClient,
  row: ClaimedDelivery,
  deps: WebhookDeliveryDeps,
  bodyFor: (row: ClaimedDelivery) => Promise<string | null> = (r) =>
    ensurePayloadBody(sql, r, deps.appBaseUrl),
): Promise<DeliveryResult> {
  // A test ping goes to the destination even while it is turned off, so the
  // owner can check a URL before switching it on.
  if (!row.destination_enabled && row.event_type !== OUTBOUND_TEST_EVENT_TYPE) {
    await markCancelled(sql, row, "Destination turned off");
    return { status: "cancelled", reason: "destination_disabled" };
  }

  let body: string | null;
  try {
    body = await bodyFor(row);
  } catch (err) {
    if (!(err instanceof OutboundPayloadInvalidError)) throw err;
    deps.logger.error("outbound_webhook_payload_invalid", {
      tenant_id: row.tenant_id,
      event_id: row.event_id,
      issues: err.issues,
    });
    return recordOutcome(
      sql,
      row,
      {
        kind: "retry",
        statusCode: null,
        error: "Heyloo couldn't prepare this event",
        retryAfterSeconds: null,
      },
      deps,
    );
  }
  if (body === null) {
    await markCancelled(sql, row, "The booking, order or message no longer exists");
    return { status: "cancelled", reason: "entity_missing" };
  }

  if (!row.secret) {
    deps.logger.error("outbound_webhook_secret_missing", {
      tenant_id: row.tenant_id,
      destination_id: row.destination_id,
    });
  }
  const outcome = row.secret
    ? await sendSignedWebhook(
        { url: row.url, webhookId: webhookIdForEvent(row.event_id), body, secret: row.secret },
        deps,
      )
    : ({
        kind: "retry",
        statusCode: null,
        error: "Signing secret missing",
        retryAfterSeconds: null,
      } satisfies AttemptOutcome);

  const result = await recordOutcome(sql, row, outcome, deps);
  deps.logger.info("outbound_webhook_attempt", {
    tenant_id: row.tenant_id,
    delivery_id: row.id,
    destination_id: row.destination_id,
    event_type: row.event_type,
    attempt: row.attempt_count,
    result: result.status,
    status_code: "statusCode" in result ? result.statusCode : null,
  });
  return result;
}

/** Delivers one claimed batch, up to `concurrency` at a time, into `result`. */
async function deliverBatch(
  sql: SqlClient,
  claimed: ClaimedDelivery[],
  deps: WebhookDeliveryDeps,
  result: RunWebhookDeliveryResult,
): Promise<void> {
  // Two destinations of one event in the same batch share ONE build (and so
  // the same stored bytes): the per-event promise is memoized. A later batch
  // reads the stored payload from its own claim.
  const bodies = new Map<string, Promise<string | null>>();
  const bodyFor = (row: ClaimedDelivery): Promise<string | null> => {
    let body = bodies.get(row.event_id);
    if (!body) {
      body = ensurePayloadBody(sql, row, deps.appBaseUrl);
      bodies.set(row.event_id, body);
    }
    return body;
  };

  const queue = [...claimed];
  const worker = async (): Promise<void> => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      try {
        const outcome = await processClaimedDelivery(sql, row, deps, bodyFor);
        if (outcome.status === "delivered") result.delivered += 1;
        else if (outcome.status === "retrying") result.retrying += 1;
        else if (outcome.status === "failed") result.failed += 1;
        else result.cancelled += 1;
      } catch (err) {
        result.errors += 1;
        deps.logger.error("outbound_webhook_delivery_error", {
          tenant_id: row.tenant_id,
          delivery_id: row.id,
          error: err instanceof Error ? err.message : String(err),
        });
        // Recorded like any failed attempt (backoff; the final attempt fails
        // and alerts), so a row that throws every time still ends. If even
        // this write fails, the lease expires: the row is re-claimed while
        // attempts are left, else failAbandonedDeliveries fails it.
        await recordOutcome(
          sql,
          row,
          { kind: "retry", statusCode: null, error: PROCESSING_ERROR, retryAfterSeconds: null },
          deps,
        ).catch((recordErr: unknown) => {
          deps.logger.error("outbound_webhook_record_failed", {
            tenant_id: row.tenant_id,
            delivery_id: row.id,
            error: recordErr instanceof Error ? recordErr.message : String(recordErr),
          });
        });
      }
    }
  };
  const lanes = Math.max(1, Math.min(deps.concurrency ?? WEBHOOK_CONCURRENCY, claimed.length));
  await Promise.all(Array.from({ length: lanes }, worker));
}

/**
 * worker-tick leg: fail abandoned leases, then claim and deliver batches in
 * rounds until a claim comes back short, the round deadline passes, or the
 * round cap is hit. Stopping on a full batch reports (and logs) the backlog.
 */
export async function runWebhookDeliveryWorker(
  sql: SqlClient,
  deps: WebhookDeliveryDeps,
): Promise<RunWebhookDeliveryResult> {
  const clock = deps.now ?? (() => new Date());
  const startedAt = clock().getTime();
  const batchSize = deps.batchSize ?? WEBHOOK_BATCH_SIZE;
  const maxRounds = deps.maxRounds ?? WEBHOOK_MAX_ROUNDS;
  const roundDeadlineMs = deps.roundStartDeadlineMs ?? WEBHOOK_ROUND_START_DEADLINE_MS;
  const result: RunWebhookDeliveryResult = {
    claimed: 0,
    delivered: 0,
    retrying: 0,
    failed: 0,
    cancelled: 0,
    errors: 0,
    abandoned: 0,
    rounds: 0,
    backlog: 0,
  };

  try {
    result.abandoned = await failAbandonedDeliveries(sql, deps.logger);
  } catch (err) {
    // Never let the sweep block delivery itself.
    deps.logger.error("outbound_webhook_abandoned_sweep_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  let lastBatchFull = false;
  while (result.rounds < maxRounds) {
    if (result.rounds > 0 && clock().getTime() - startedAt >= roundDeadlineMs) break;
    const claimed = await claimDueDeliveries(sql, batchSize);
    result.rounds += 1;
    result.claimed += claimed.length;
    lastBatchFull = claimed.length >= batchSize;
    if (claimed.length > 0) await deliverBatch(sql, claimed, deps, result);
    if (!lastBatchFull) break;
  }

  if (lastBatchFull) {
    try {
      result.backlog = await countDueDeliveries(sql);
    } catch (err) {
      deps.logger.error("outbound_webhook_backlog_count_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (result.backlog > 0) {
      deps.logger.warn("outbound_webhook_backlog", {
        due: result.backlog,
        rounds: result.rounds,
        claimed: result.claimed,
      });
    }
  }
  return result;
}
