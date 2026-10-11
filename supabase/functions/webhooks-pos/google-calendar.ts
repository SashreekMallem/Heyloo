import { channelTokenMatches } from "../_shared/calendar/watch.ts";
import { parseGoogleCalendarNotification } from "../_shared/providers/google-calendar.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * CAL-1b: a Google Calendar push notification
 * (`POST /webhooks-pos/google_calendar`). Google sends no body and no
 * platform-wide signature: each connection's channel was registered by the
 * worker-tick sync leg with its own random token (only its SHA-256 hex is
 * stored). Pipeline (CLAUDE.md Rule 2):
 *
 *  1. Verify first, fail CLOSED (401): the always-sent headers must be
 *     present and well-formed, `X-Goog-Channel-ID` must name a stored
 *     channel, `X-Goog-Channel-Token` must hash (timing-safe compare) to that
 *     channel's `watch_token_hash`, and `X-Goog-Resource-ID` must equal its
 *     `watch_resource_id`. An unknown or replaced channel is refused.
 *  2. `sync` (the "channel created" message) -> 200, nothing written.
 *  3. Anything else (`exists`, `not_exists`): ONE statement does the
 *     idempotent insert into `webhook_events` (source `google_calendar`,
 *     event id `<channel id>:<message number>`, unique per channel) and,
 *     only when that insert is new, marks `busy_sync_requested_at = now()`
 *     on the still-connected connection — then 200 fast. The read itself is
 *     the async work: the next worker-tick (within about a minute) claims
 *     the request and reads Google. A redelivered notification is a no-op.
 *
 * The notification carries no change content, so nothing else is trusted
 * from it; the tenant comes only from the stored channel's row.
 */

export interface GoogleNotificationResponse {
  status: number;
  body: Record<string, unknown>;
}

interface ChannelRow {
  id: string;
  tenant_id: string;
  status: string;
  watch_resource_id: string | null;
  watch_token_hash: string | null;
}

const UNAUTHORIZED: GoogleNotificationResponse = {
  status: 401,
  body: { error: "unauthorized" },
};

export async function handleGoogleCalendarNotification(
  sql: SqlClient,
  getHeader: (name: string) => string | null,
  logger: Logger,
): Promise<GoogleNotificationResponse> {
  const parsed = parseGoogleCalendarNotification(getHeader);
  if (!parsed.ok) {
    logger.warn("pos_google_calendar_rejected", { reason: "missing_or_malformed_headers" });
    return UNAUTHORIZED;
  }
  const n = parsed.notification;

  const rows = await sql<ChannelRow>`
    /* google_calendar_notification:lookup */
    select id, tenant_id, status, watch_resource_id, watch_token_hash
    from public.adapter_connections
    where provider = 'google_calendar' and watch_channel_id = ${n.channelId}
    limit 1
  `;
  const connection = rows[0];
  if (!connection) {
    logger.warn("pos_google_calendar_rejected", { reason: "unknown_channel" });
    return UNAUTHORIZED;
  }
  // Token before resource id; both must match, and a missing stored value
  // never matches (fail closed).
  if (!(await channelTokenMatches(n.channelToken, connection.watch_token_hash))) {
    logger.warn("pos_google_calendar_rejected", {
      reason: n.channelToken ? "token_mismatch" : "token_missing",
      connection_id: connection.id,
    });
    return UNAUTHORIZED;
  }
  if (!connection.watch_resource_id || n.resourceId !== connection.watch_resource_id) {
    logger.warn("pos_google_calendar_rejected", {
      reason: "resource_mismatch",
      connection_id: connection.id,
    });
    return UNAUTHORIZED;
  }

  if (n.resourceState === "sync") {
    return { status: 200, body: { received: true } };
  }

  const recorded = await sql<{ inserted: number; requested: number }>`
    /* google_calendar_notification:record */
    with ev as (
      insert into public.webhook_events
        (source, event_id, event_type, payload, signature_verified, processed_at)
      values ('google_calendar', ${`${n.channelId}:${n.messageNumber}`}, 'calendar_changed',
        ${{
          connection_id: connection.id,
          channel_id: n.channelId,
          resource_state: n.resourceState,
          message_number: n.messageNumber,
        }}::jsonb,
        true, now())
      on conflict (source, event_id) do nothing
      returning id
    ), requested as (
      update public.adapter_connections c
      set busy_sync_requested_at = now()
      from ev
      where c.id = ${connection.id} and c.tenant_id = ${connection.tenant_id}
        and c.provider = 'google_calendar' and c.status = 'connected'
        and c.watch_channel_id = ${n.channelId}
      returning c.id
    )
    select (select count(*) from ev)::int as inserted,
      (select count(*) from requested)::int as requested
  `;
  const row = recorded[0];
  logger.info("pos_google_calendar_change_notified", {
    tenant_id: connection.tenant_id,
    connection_id: connection.id,
    duplicate: (row?.inserted ?? 0) === 0,
    read_requested: (row?.requested ?? 0) > 0,
  });
  return { status: 200, body: { received: true } };
}
