import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TenantIdProvider } from "@/lib/tenant/tenant-context";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "maybeSingle", "update"]) {
    obj[method] = vi.fn(() => obj);
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: {
    from: vi.fn((table: string) => {
      if (table === "agent_configs") {
        return chain({ data: { dynamic_variable_overrides: {} }, error: null });
      }
      if (table === "tenants") return chain({ data: { a2p_status: "verified" }, error: null });
      return chain({ data: null, error: null });
    }),
  },
}));

import DeliveryPage from "./page";

function renderPage() {
  const client = new QueryClient();
  return render(
    <TenantIdProvider tenantId="t1">
      <QueryClientProvider client={client}>
        <DeliveryPage />
      </QueryClientProvider>
    </TenantIdProvider>,
  );
}

describe("DeliveryPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never crashes when the Airtable status response has no sync_log array", async () => {
    // A shape-mismatched response (missing `sync_log`) must never throw on
    // `.length`/`.map`.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ status: "connected" })),
    );
    renderPage();
    expect(await screen.findByText("Delivery preferences")).toBeInTheDocument();
    expect(screen.queryByText(/sync log/i)).not.toBeInTheDocument();
  });

  it("shows the sync log toggle once real sync_log rows are present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "connected",
          last_synced_at: null,
          sync_log: [
            {
              entity_type: "booking",
              entity_id: "b1234567",
              sync_conflict: false,
              last_synced_at: null,
            },
          ],
        }),
      ),
    );
    renderPage();
    expect(await screen.findByText(/show sync log \(1\)/i)).toBeInTheDocument();
  });
});
