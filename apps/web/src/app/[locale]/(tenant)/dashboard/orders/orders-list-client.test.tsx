import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const ordersEqCalls: [string, unknown][] = [];

function chain(result: unknown, eqCalls?: [string, unknown][]) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "order", "range", "in"]) {
    obj[method] = vi.fn(() => obj);
  }
  obj["eq"] = vi.fn((col: string, val: unknown) => {
    eqCalls?.push([col, val]);
    return obj;
  });
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: {
    from: vi.fn((table: string) => {
      if (table === "orders") return chain({ data: [], count: 0, error: null }, ordersEqCalls);
      if (table === "customers") return chain({ data: [], error: null });
      if (table === "payment_links") return chain({ data: [], error: null });
      return chain({ data: null, error: null });
    }),
  },
}));

import { OrdersListClient } from "./orders-list-client";

describe("OrdersListClient (PUBLISH-1 — is_test filter)", () => {
  it("filters the orders query on is_test = false, mirroring the bookings list page (CALL-6)", async () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <OrdersListClient tenantId="t1" />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(ordersEqCalls).toContainEqual(["is_test", false]));
  });
});
