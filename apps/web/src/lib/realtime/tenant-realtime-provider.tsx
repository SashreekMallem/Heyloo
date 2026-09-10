"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { getTenantRealtimeChannelName } from "./channel";

export type RealtimeConnectionStatus = "connecting" | "connected" | "reconnecting" | "offline";

const RealtimeStatusContext = createContext<RealtimeConnectionStatus>("connecting");

const BACKOFF_MS = [1000, 2000, 4000, 8000];
const MAX_ATTEMPTS = BACKOFF_MS.length;

interface BroadcastPayload {
  table: string;
  op: string;
  id: string;
}

/**
 * `TenantRealtimeProvider` — subscribes to the tenant's single private
 * channel (`` `tenant:${tenant_id}` `` via {@link getTenantRealtimeChannelName},
 * `private: true`, RLS on `realtime.messages` — SYSTEM_DESIGN §2 exact
 * contract, FRONTEND_SPEC.md §0.3/§9.6). This topic string must stay
 * byte-for-byte identical to `fn_broadcast_tenant_update()`'s
 * `'tenant:' || tenant_id` and the `tenant_channel_broadcast_select` RLS
 * policy's `'tenant:' || fn_jwt_tenant_id()` (docs/audit/E2E_FLOWS_AUDIT.md
 * B3 — previously `private-tenant-${tenantId}`, which never matched either
 * side and meant no broadcast was ever received). The handler invalidates
 * the matching TanStack Query key using `payload.table` — a real field of
 * `realtime.broadcast_changes()`'s payload (`topic, operation, table,
 * schema, record, old_record`, confirmed against supabase/supabase's own
 * `examples/prompts/use-realtime.md`, since supabase.com's hosted docs are
 * egress-blocked in this environment — see docs/VERIFY.md), never the row
 * itself.
 * Reconnect lifecycle: connecting → connected → reconnecting (exponential
 * backoff 1s/2s/4s/8s) → offline after `MAX_ATTEMPTS` failures. Broadcasts
 * are not durable/replayed — on reconnect, invalidate every active
 * tenant-scoped query once rather than reconstructing what was missed.
 * Wraps the `(tenant)` layout AND, once `tenant_id` exists, the signup
 * provisioning step (§4.5) — admin/partner have no realtime provider at
 * all (§0.3).
 */
export function TenantRealtimeProvider({
  tenantId,
  children,
}: {
  tenantId: string;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<RealtimeConnectionStatus>("connecting");
  const queryClient = useQueryClient();
  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let disposed = false;
    let channel: ReturnType<typeof supabaseBrowserClient.channel> | null = null;

    function connect() {
      if (disposed) return;
      setStatus(attemptRef.current === 0 ? "connecting" : "reconnecting");

      channel = supabaseBrowserClient.channel(getTenantRealtimeChannelName(tenantId), {
        config: { private: true },
      });

      channel
        .on("broadcast", { event: "*" }, ({ payload }: { payload: BroadcastPayload }) => {
          if (payload?.table) {
            void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, payload.table] });
          }
        })
        .subscribe((subscribeStatus) => {
          if (disposed) return;
          if (subscribeStatus === "SUBSCRIBED") {
            const wasReconnect = attemptRef.current > 0;
            attemptRef.current = 0;
            setStatus("connected");
            if (wasReconnect) {
              // Broadcasts aren't replayed — refetch everything active once.
              void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId] });
            }
          } else if (
            subscribeStatus === "CHANNEL_ERROR" ||
            subscribeStatus === "TIMED_OUT" ||
            subscribeStatus === "CLOSED"
          ) {
            scheduleReconnect();
          }
        });
    }

    function scheduleReconnect() {
      if (disposed) return;
      if (attemptRef.current >= MAX_ATTEMPTS) {
        setStatus("offline");
        return;
      }
      const delay = BACKOFF_MS[attemptRef.current] ?? BACKOFF_MS[BACKOFF_MS.length - 1] ?? 8000;
      attemptRef.current += 1;
      setStatus("reconnecting");
      timerRef.current = setTimeout(() => {
        if (channel) void supabaseBrowserClient.removeChannel(channel);
        connect();
      }, delay);
    }

    connect();

    return () => {
      disposed = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (channel) void supabaseBrowserClient.removeChannel(channel);
    };
  }, [tenantId, queryClient]);

  return <RealtimeStatusContext.Provider value={status}>{children}</RealtimeStatusContext.Provider>;
}

export function useTenantRealtimeStatus(): RealtimeConnectionStatus {
  return useContext(RealtimeStatusContext);
}
