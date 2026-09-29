"use client";

import { formatPhoneDisplay } from "@heyloo/ui";
import type { NotificationItem } from "@heyloo/ui/notification";
import { useQuery } from "@tanstack/react-query";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

const NOTIFICATIONS_KEY = (tenantId: string) =>
  ["tenant", tenantId, "bookings", "notifications"] as const;

interface BookingRow {
  id: string;
  created_at: string;
  status: string;
  start_at: string;
  customer_id: string | null;
}

interface CallRow {
  id: string;
  created_at: string;
  caller_number: string | null;
  classification: string | null;
}

interface TextRow {
  id: string;
  created_at: string;
  from_e164: string;
  body: string;
}

const BOOKING_VERBS: Record<string, string> = {
  scheduled: "booked",
  confirmed: "confirmed",
  checked_in: "checked in",
  completed: "completed",
  cancelled: "cancelled",
  rescheduled: "rescheduled",
  no_show: "no-show",
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Builds the bell's feed from bookings, urgent calls and inbound texts (QA-1
 * F-04). Every item names who/when and deep-links to the thing itself;
 * `read` is computed against the member's own `last_seen_notifications_at`.
 * Exported (pure) so the mapping is unit-testable.
 */
export function buildNotificationItems(
  sources: {
    bookings: BookingRow[];
    calls: CallRow[];
    texts: TextRow[];
    customerNames: Map<string, string | null>;
  },
  lastSeen: string,
): NotificationItem[] {
  const items: NotificationItem[] = [
    ...sources.bookings.map((b) => ({
      id: `booking:${b.id}`,
      title: `${(b.customer_id ? sources.customerNames.get(b.customer_id) : null)?.trim() || "A customer"} — booking ${BOOKING_VERBS[b.status] ?? b.status}`,
      description: formatWhen(b.start_at),
      createdAt: b.created_at,
      read: b.created_at <= lastSeen,
      href: `/dashboard/bookings?booking=${b.id}`,
    })),
    ...sources.calls.map((c) => ({
      id: `call:${c.id}`,
      title: `${c.classification === "emergency" ? "Emergency" : "Urgent"} call`,
      description: c.caller_number ? formatPhoneDisplay(c.caller_number) : "Unknown number",
      createdAt: c.created_at,
      read: c.created_at <= lastSeen,
      href: `/dashboard/calls/${c.id}`,
    })),
    ...sources.texts.map((t) => ({
      id: `text:${t.id}`,
      title: `New text from ${formatPhoneDisplay(t.from_e164)}`,
      description: t.body.length > 80 ? `${t.body.slice(0, 80)}…` : t.body,
      createdAt: t.created_at,
      read: t.created_at <= lastSeen,
      href: `/dashboard/messages/${encodeURIComponent(t.from_e164)}`,
    })),
  ];
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 15);
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabaseBrowserClient.auth.getSession();
  return data.session?.user.id ?? null;
}

/**
 * Derived notification feed (FRONTEND_SPEC.md §9.4 DECIDE — no dedicated
 * `notifications` table; "unread" computed against
 * `memberships.last_seen_notifications_at`). Sources: new bookings, urgent
 * calls, inbound texts. Polled rather than realtime-pushed here (the
 * realtime provider already invalidates `["tenant", tenantId, "bookings"]`
 * etc. on the matching broadcast, which refetches this too since it shares
 * the query key prefix).
 *
 * The membership lookup is filtered to the signed-in user: `memberships`
 * RLS exposes every member of the tenant, so an unfiltered `.maybeSingle()`
 * errored (PGRST116) for any multi-member tenant and every booking read as
 * unread forever (QA-1 F-04).
 */
export function useTenantNotifications(tenantId: string) {
  return useQuery({
    queryKey: NOTIFICATIONS_KEY(tenantId),
    queryFn: async () => {
      const userId = await currentUserId();
      const membershipQuery = userId
        ? supabaseBrowserClient
            .from("memberships")
            .select("last_seen_notifications_at")
            .eq("tenant_id", tenantId)
            .eq("user_id", userId)
            .maybeSingle()
        : Promise.resolve({ data: null });
      const { data: membership } = await membershipQuery;
      // No membership row / not signed in: treat everything as already seen
      // rather than flagging the whole history as unread.
      const lastSeen = membership?.last_seen_notifications_at ?? new Date().toISOString();

      const [{ data: bookings }, { data: calls }, { data: texts }] = await Promise.all([
        supabaseBrowserClient
          .from("bookings")
          .select("id, created_at, status, start_at, customer_id")
          .eq("tenant_id", tenantId)
          // PUBLISH-1 (docs/BUILD_NOTES.md, ONBOARD-1's own flagged
          // inconsistency): the bell previously had NO `is_test` filter at
          // all — it would surface a Retell batch-test/simulator booking as
          // "Booking confirmed" even though the bookings list itself
          // (`bookings/page.tsx`) already hides it. Mirrors that page's own
          // `.eq("is_test", false)` (CALL-6).
          .eq("is_test", false)
          .order("created_at", { ascending: false })
          .limit(10),
        supabaseBrowserClient
          .from("call_logs")
          .select("id, created_at, caller_number, classification")
          .eq("tenant_id", tenantId)
          .eq("is_test_call", false)
          .eq("urgency_flag", true)
          .order("created_at", { ascending: false })
          .limit(5),
        supabaseBrowserClient
          .from("messages_inbound")
          .select("id, created_at, from_e164, body")
          .eq("tenant_id", tenantId)
          .eq("classification", "other")
          .order("created_at", { ascending: false })
          .limit(5),
      ]);

      // The generated Database type carries no PostgREST relationship for
      // bookings -> customers, so resolve names with a second tenant-scoped query.
      const customerIds = [
        ...new Set((bookings ?? []).map((b) => b.customer_id).filter((id): id is string => !!id)),
      ];
      const { data: customers } = customerIds.length
        ? await supabaseBrowserClient
            .from("customers")
            .select("id, name")
            .eq("tenant_id", tenantId)
            .in("id", customerIds)
        : { data: [] as { id: string; name: string | null }[] };
      const customerNames = new Map((customers ?? []).map((c) => [c.id, c.name]));

      const items = buildNotificationItems(
        {
          bookings: (bookings ?? []) as BookingRow[],
          calls: (calls ?? []) as CallRow[],
          texts: (texts ?? []) as TextRow[],
          customerNames,
        },
        lastSeen,
      );

      return { items, unreadCount: items.filter((i) => !i.read).length };
    },
    refetchInterval: 60_000,
  });
}

/**
 * Marks the whole feed read for the signed-in member (writes their own
 * `memberships.last_seen_notifications_at`; column grant + the
 * `memberships_update_own_seen` policy in 20260930200200 allow exactly that).
 * Returns whether a row was updated.
 */
export async function markNotificationsSeen(tenantId: string): Promise<boolean> {
  const userId = await currentUserId();
  if (!userId) return false;
  const { data, error } = await supabaseBrowserClient
    .from("memberships")
    .update({ last_seen_notifications_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .select("user_id");
  return !error && (data?.length ?? 0) > 0;
}

export { NOTIFICATIONS_KEY as notificationsQueryKey };
