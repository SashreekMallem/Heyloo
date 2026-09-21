import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

function chain(result: unknown, captured: { eqCalls: [string, unknown][] }) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "order", "limit", "maybeSingle"]) {
    obj[method] = vi.fn(() => obj);
  }
  obj["eq"] = vi.fn((col: string, val: unknown) => {
    captured.eqCalls.push([col, val]);
    return obj;
  });
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

describe("useTenantNotifications (PUBLISH-1 — is_test filter)", () => {
  it("filters the bookings source on is_test = false, mirroring the bookings list page (CALL-6)", async () => {
    const bookingsCaptured = { eqCalls: [] as [string, unknown][] };
    vi.doMock("@/lib/supabase/browser", () => ({
      supabaseBrowserClient: {
        from: vi.fn((table: string) => {
          if (table === "memberships") {
            return chain(
              { data: { last_seen_notifications_at: null }, error: null },
              {
                eqCalls: [],
              },
            );
          }
          if (table === "bookings") {
            return chain({ data: [], error: null }, bookingsCaptured);
          }
          return chain({ data: null, error: null }, { eqCalls: [] });
        }),
      },
    }));

    const { useTenantNotifications } = await import("./use-tenant-notifications");
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useTenantNotifications("t1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(bookingsCaptured.eqCalls).toContainEqual(["is_test", false]);

    vi.doUnmock("@/lib/supabase/browser");
  });
});
