import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TenantIdProvider } from "@/lib/tenant/tenant-context";

import IntegrationsPage from "./page";

function renderPage() {
  const client = new QueryClient();
  return render(
    <TenantIdProvider tenantId="t1">
      <QueryClientProvider client={client}>
        <IntegrationsPage />
      </QueryClientProvider>
    </TenantIdProvider>,
  );
}

describe("IntegrationsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never crashes and reads as empty when the response has no integrations array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ rows: [] })),
    );
    renderPage();
    expect(await screen.findByText("No integrations available")).toBeInTheDocument();
  });

  it("renders real integration cards once loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          integrations: [
            {
              provider: "square",
              display_name: "Square",
              status: "disconnected",
              last_refreshed_at: null,
              last_error: null,
              can_manage: true,
            },
          ],
        }),
      ),
    );
    renderPage();
    expect(await screen.findByText("Square")).toBeInTheDocument();
  });
});
