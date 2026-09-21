"use client";

import type { NotificationItem } from "@heyloo/ui/notification";
import { useQuery } from "@tanstack/react-query";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * Derived notification feed (FRONTEND_SPEC.md §9.4 DECIDE — no dedicated
 * `notifications` table; "unread" computed against
 * `memberships.last_seen_notifications_at`). Sources: new bookings, recent
 * support ticket replies. Polled rather than realtime-pushed here (the
 * realtime provider already invalidates `["tenant", tenantId, "bookings"]`
 * etc. on the matching broadcast, which refetches this too since it shares
 * the query key prefix).
 */
export function useTenantNotifications(tenantId: string) {
  return useQuery({
    queryKey: ["tenant", tenantId, "bookings", "notifications"],
    queryFn: async () => {
      const { data: membership } = await supabaseBrowserClient
        .from("memberships")
        .select("last_seen_notifications_at")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      const lastSeen = membership?.last_seen_notifications_at ?? new Date(0).toISOString();

      const { data: bookings } = await supabaseBrowserClient
        .from("bookings")
        .select("id, created_at, status")
        .eq("tenant_id", tenantId)
        // PUBLISH-1 (docs/BUILD_NOTES.md, ONBOARD-1's own flagged
        // inconsistency): the bell previously had NO `is_test` filter at
        // all — it would surface a Retell batch-test/simulator booking as
        // "Booking confirmed" even though the bookings list itself
        // (`bookings/page.tsx`) already hides it. Mirrors that page's own
        // `.eq("is_test", false)` (CALL-6).
        .eq("is_test", false)
        .order("created_at", { ascending: false })
        .limit(10);

      const items: NotificationItem[] = (bookings ?? []).map((booking) => ({
        id: booking.id,
        title: `Booking ${booking.status}`,
        createdAt: booking.created_at,
        read: booking.created_at <= lastSeen,
        href: `/dashboard/bookings`,
      }));

      return { items, unreadCount: items.filter((i) => !i.read).length };
    },
    refetchInterval: 60_000,
  });
}
