import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

type Captured = { eqCalls: [string, unknown][]; updates: unknown[] };

function chain(result: unknown, captured: Captured) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "order", "limit", "maybeSingle", "in"]) {
    obj[method] = vi.fn(() => obj);
  }
  obj["update"] = vi.fn((patch: unknown) => {
    captured.updates.push(patch);
    return obj;
  });
  obj["eq"] = vi.fn((col: string, val: unknown) => {
    captured.eqCalls.push([col, val]);
    return obj;
  });
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

function mockSupabase(tables: Record<string, { result: unknown; captured: Captured }>) {
  vi.doMock("@/lib/supabase/browser", () => ({
    supabaseBrowserClient: {
      auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
      from: vi.fn((table: string) => {
        const t = tables[table];
        return t ? chain(t.result, t.captured) : chain({ data: [], error: null }, cap());
      }),
    },
  }));
}

const cap = (): Captured => ({ eqCalls: [], updates: [] });

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

afterEach(() => {
  vi.doUnmock("@/lib/supabase/browser");
  vi.resetModules();
});

describe("useTenantNotifications (PUBLISH-1 — is_test filter)", () => {
  it("filters the bookings source on is_test = false, mirroring the bookings list page (CALL-6)", async () => {
    const bookings = cap();
    mockSupabase({
      memberships: {
        result: { data: { last_seen_notifications_at: null }, error: null },
        captured: cap(),
      },
      bookings: { result: { data: [], error: null }, captured: bookings },
    });
    const { useTenantNotifications } = await import("./use-tenant-notifications");
    const { result } = renderHook(() => useTenantNotifications("t1"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(bookings.eqCalls).toContainEqual(["is_test", false]);
  });
});

describe("useTenantNotifications (QA-1 F-04)", () => {
  it("looks up the signed-in member's own membership row (not just any member of the tenant)", async () => {
    const memberships = cap();
    mockSupabase({
      memberships: {
        result: { data: { last_seen_notifications_at: "2026-09-29T00:00:00Z" }, error: null },
        captured: memberships,
      },
    });
    const { useTenantNotifications } = await import("./use-tenant-notifications");
    const { result } = renderHook(() => useTenantNotifications("t1"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(memberships.eqCalls).toContainEqual(["tenant_id", "t1"]);
    expect(memberships.eqCalls).toContainEqual(["user_id", "user-1"]);
  });

  it("names the customer and time, deep-links to the booking, and counts only items newer than last-seen", async () => {
    mockSupabase({
      memberships: {
        result: { data: { last_seen_notifications_at: "2026-09-29T12:00:00Z" }, error: null },
        captured: cap(),
      },
      bookings: {
        result: {
          data: [
            {
              id: "b-new",
              created_at: "2026-09-29T13:00:00Z",
              status: "scheduled",
              start_at: "2026-10-01T14:00:00Z",
              customer_id: "cust-1",
            },
            {
              id: "b-old",
              created_at: "2026-09-28T09:00:00Z",
              status: "completed",
              start_at: "2026-09-28T10:00:00Z",
              customer_id: null,
            },
          ],
          error: null,
        },
        captured: cap(),
      },
      customers: {
        result: { data: [{ id: "cust-1", name: "Jamie Cruz" }], error: null },
        captured: cap(),
      },
      call_logs: {
        result: {
          data: [
            {
              id: "c1",
              created_at: "2026-09-29T14:00:00Z",
              caller_number: "+15125551000",
              classification: "emergency",
            },
          ],
          error: null,
        },
        captured: cap(),
      },
      messages_inbound: {
        result: {
          data: [
            {
              id: "m1",
              created_at: "2026-09-29T15:00:00Z",
              from_e164: "+15125552000",
              body: "Running late",
            },
          ],
          error: null,
        },
        captured: cap(),
      },
    });
    const { useTenantNotifications } = await import("./use-tenant-notifications");
    const { result } = renderHook(() => useTenantNotifications("t1"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const { items, unreadCount } = result.current.data ?? { items: [], unreadCount: -1 };

    expect(unreadCount).toBe(3);
    // newest first
    expect(items.map((i) => i.id)).toEqual([
      "text:m1",
      "call:c1",
      "booking:b-new",
      "booking:b-old",
    ]);
    const booking = items.find((i) => i.id === "booking:b-new");
    expect(booking?.title).toBe("Jamie Cruz — booking booked");
    expect(booking?.description).toMatch(/Oct/);
    expect(booking?.href).toBe("/dashboard/bookings?booking=b-new");
    expect(items.find((i) => i.id === "booking:b-old")?.title).toBe(
      "A customer — booking completed",
    );
    expect(items.find((i) => i.id === "call:c1")).toMatchObject({
      title: "Emergency call",
      description: "(512) 555-1000",
      href: "/dashboard/calls/c1",
    });
    expect(items.find((i) => i.id === "text:m1")).toMatchObject({
      title: "New text from (512) 555-2000",
      description: "Running late",
      href: "/dashboard/messages/%2B15125552000",
    });
  });

  it("markNotificationsSeen writes the member's own last_seen_notifications_at", async () => {
    const memberships = cap();
    mockSupabase({
      memberships: {
        result: { data: [{ user_id: "user-1" }], error: null },
        captured: memberships,
      },
    });
    const { markNotificationsSeen } = await import("./use-tenant-notifications");
    await expect(markNotificationsSeen("t1")).resolves.toBe(true);
    expect(memberships.updates).toHaveLength(1);
    expect(memberships.updates[0]).toEqual({
      last_seen_notifications_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(memberships.eqCalls).toContainEqual(["tenant_id", "t1"]);
    expect(memberships.eqCalls).toContainEqual(["user_id", "user-1"]);
  });

  it("markNotificationsSeen reports failure when no row was updated (e.g. RLS blocked it)", async () => {
    mockSupabase({
      memberships: { result: { data: [], error: null }, captured: cap() },
    });
    const { markNotificationsSeen } = await import("./use-tenant-notifications");
    await expect(markNotificationsSeen("t1")).resolves.toBe(false);
  });
});
