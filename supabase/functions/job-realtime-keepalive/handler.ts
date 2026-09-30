import type { Logger } from "../_shared/types.ts";

/**
 * Realtime keep-alive (QA-2 BE-03).
 *
 * `realtime.messages` is partitioned by day and Realtime's own service creates
 * the partitions (a rolling window of yesterday, today and the next three
 * days). Per supabase.com/docs/guides/troubleshooting/
 * realtime-warn-sending-broadcast-message (verified 2026-09-30) it does that
 * only (1) the first time a client joins a channel after migrations run and
 * (2) in a janitor pass every ~3-4 h that "only covers projects that are
 * currently connected, or that connected since its previous run".
 * `realtime.send`, the broadcast REST endpoint and subscribe/replication
 * operations create nothing. The dashboards' live-update triggers broadcast
 * from the database, so a project with no browser connected for a day has no
 * partition for today, every broadcast insert fails and the dashboards show
 * "Live updates paused". The migration role cannot create the partitions
 * itself (it owns neither `realtime.messages` nor the schema; QA-1 review), so
 * the durable fix is a client that connects on a schedule: this job joins one
 * throw-away public channel over the Realtime WebSocket and leaves again.
 *
 * Wire format (supabase.com/docs/guides/realtime/protocol, verified
 * 2026-09-30): `wss://<ref>.supabase.co/realtime/v1/websocket?apikey=<key>&vsn=2.0.0`,
 * messages are `[join_ref, ref, topic, event, payload]`, the join is
 * `phx_join` on `realtime:<name>` and the server answers `phx_reply` with
 * `payload.status` `"ok"` or `"error"` (`payload.response.reason`).
 */

export const KEEPALIVE_CHANNEL = "realtime:heyloo-keepalive";
const JOIN_REF = "1";
const JOIN_MSG_REF = "1";

/** The subset of the WHATWG WebSocket this job uses (so tests can fake it). */
export interface KeepaliveSocket {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface RealtimeKeepaliveDeps {
  supabaseUrl: string;
  /** Publishable key: the join needs a valid apikey, never a secret. */
  apiKey: string;
  createSocket: (url: string) => KeepaliveSocket;
  logger: Logger;
  timeoutMs?: number;
}

export type RealtimeKeepaliveOutcome =
  | { ok: true }
  | { ok: false; reason: "join_error" | "socket_error" | "closed" | "timeout"; detail?: string };

/** `https://<ref>.supabase.co` -> the Realtime WebSocket endpoint (apikey never logged). */
export function realtimeSocketUrl(supabaseUrl: string, apiKey: string): string {
  const u = new URL(supabaseUrl);
  const scheme = u.protocol === "http:" ? "ws:" : "wss:";
  return `${scheme}//${u.host}/realtime/v1/websocket?apikey=${encodeURIComponent(apiKey)}&vsn=2.0.0`;
}

export function buildJoinMessage(): string {
  return JSON.stringify([
    JOIN_REF,
    JOIN_MSG_REF,
    KEEPALIVE_CHANNEL,
    "phx_join",
    {
      config: {
        broadcast: { ack: false, self: false },
        presence: { enabled: false },
        postgres_changes: [],
        private: false,
      },
    },
  ]);
}

/** Parses a v2 frame; null for anything that is not a well-formed array frame. */
function parseFrame(
  data: unknown,
): { ref: unknown; topic: unknown; event: unknown; payload: unknown } | null {
  if (typeof data !== "string") return null;
  try {
    const frame: unknown = JSON.parse(data);
    if (!Array.isArray(frame) || frame.length < 5) return null;
    return { ref: frame[1], topic: frame[2], event: frame[3], payload: frame[4] };
  } catch {
    return null;
  }
}

function connectAndJoin(deps: RealtimeKeepaliveDeps): Promise<RealtimeKeepaliveOutcome> {
  const timeoutMs = deps.timeoutMs ?? 10_000;
  return new Promise((resolve) => {
    let settled = false;
    let socket: KeepaliveSocket | null = null;
    const finish = (outcome: RealtimeKeepaliveOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close(1000, "keepalive done");
      } catch {
        // already closed
      }
      resolve(outcome);
    };
    const timer = setTimeout(() => finish({ ok: false, reason: "timeout" }), timeoutMs);

    try {
      socket = deps.createSocket(realtimeSocketUrl(deps.supabaseUrl, deps.apiKey));
    } catch (err) {
      finish({
        ok: false,
        reason: "socket_error",
        detail: err instanceof Error ? err.message : "create_failed",
      });
      return;
    }
    socket.onopen = () => {
      try {
        socket?.send(buildJoinMessage());
      } catch (err) {
        finish({
          ok: false,
          reason: "socket_error",
          detail: err instanceof Error ? err.message : "send_failed",
        });
      }
    };
    socket.onmessage = (ev) => {
      const frame = parseFrame(ev.data);
      if (!frame || frame.event !== "phx_reply" || frame.topic !== KEEPALIVE_CHANNEL) return;
      if (frame.ref !== JOIN_MSG_REF) return;
      const payload = (frame.payload ?? {}) as {
        status?: unknown;
        response?: { reason?: unknown };
      };
      if (payload.status === "ok") {
        finish({ ok: true });
      } else {
        const reason = payload.response?.reason;
        finish({
          ok: false,
          reason: "join_error",
          ...(typeof reason === "string" ? { detail: reason.slice(0, 200) } : {}),
        });
      }
    };
    socket.onerror = () => finish({ ok: false, reason: "socket_error" });
    socket.onclose = () => finish({ ok: false, reason: "closed" });
  });
}

/**
 * Connects, joins the keep-alive channel, waits for the server's ack and
 * closes. Resolves (never rejects) with the outcome.
 */
export async function runRealtimeKeepalive(
  deps: RealtimeKeepaliveDeps,
): Promise<RealtimeKeepaliveOutcome> {
  const outcome = await connectAndJoin(deps);
  if (outcome.ok) deps.logger.info("job_realtime_keepalive_joined", {});
  else deps.logger.warn("job_realtime_keepalive_failed", { ...outcome });
  return outcome;
}
