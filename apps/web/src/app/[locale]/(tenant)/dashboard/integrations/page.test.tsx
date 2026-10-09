import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TenantIdProvider } from "@/lib/tenant/tenant-context";
import { fake } from "@/test/fake-supabase";

vi.mock("@/lib/supabase/browser", async () => {
  const { fakeClient } = await import("@/test/fake-supabase");
  return { supabaseBrowserClient: fakeClient() };
});

import IntegrationsPage from "./page";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <TenantIdProvider tenantId="t1">
      <QueryClientProvider client={client}>
        <IntegrationsPage />
      </QueryClientProvider>
    </TenantIdProvider>,
  );
}

function integration(overrides: Record<string, unknown>) {
  return {
    provider: "square",
    display_name: "Square",
    status: "disconnected",
    last_refreshed_at: null,
    last_error: null,
    available: false,
    can_manage: true,
    ...overrides,
  };
}

function stubIntegrations(integrations: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ integrations })),
  );
}

/** The provider's card, labelled by its title. */
function cardFor(name: string): HTMLElement {
  return screen.getByRole("group", { name });
}

describe("IntegrationsPage", () => {
  beforeEach(() => fake.reset());
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
    stubIntegrations([integration({ available: true })]);
    renderPage();
    expect(await screen.findByText("Square")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
  });

  it("OUTBOUND-1: puts the webhooks card at the top of the page", async () => {
    stubIntegrations([]);
    renderPage();
    expect(await screen.findByText("Send bookings & orders to any app")).toBeInTheDocument();
    expect(screen.getByText(/Webhooks by Zapier/)).toBeInTheDocument();
  });

  it("CONNECT-SAFE-1: a coming-soon provider shows the badge and a disabled Connect", async () => {
    stubIntegrations([
      integration({ provider: "ezyvet", display_name: "ezyVet", available: false }),
    ]);
    renderPage();
    expect(await screen.findByText("ezyVet")).toBeInTheDocument();
    const card = cardFor("ezyVet");
    expect(within(card).getByText("Coming soon")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Connect" })).toBeDisabled();
    expect(within(card).queryByLabelText(/base URL/i)).not.toBeInTheDocument();
  });

  it("CONNECT-SAFE-1: a connected coming-soon provider can still be disconnected", async () => {
    stubIntegrations([
      integration({
        status: "connected",
        available: false,
        last_refreshed_at: "2026-10-01T00:00:00Z",
      }),
    ]);
    renderPage();
    expect(await screen.findByText("Square")).toBeInTheDocument();
    const card = cardFor("Square");
    expect(within(card).getByText("Connected")).toBeInTheDocument();
    expect(within(card).queryByText("Coming soon")).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Disconnect" })).toBeEnabled();
  });

  it("CONNECT-SAFE-1: a broken connection reads Needs reconnect with friendly text, never the raw reason", async () => {
    stubIntegrations([
      integration({
        provider: "shopmonkey",
        display_name: "Shopmonkey",
        status: "error",
        last_error: "shopmonkey 401 on booking push",
        available: true,
      }),
    ]);
    renderPage();
    expect(await screen.findByText("Shopmonkey")).toBeInTheDocument();
    const card = cardFor("Shopmonkey");
    expect(within(card).getByText("Needs reconnect")).toBeInTheDocument();
    expect(within(card).getByText(/stopped accepting Heyloo's connection/)).toBeInTheDocument();
    expect(within(card).queryByText(/401/)).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Reconnect" })).toBeEnabled();
  });
});
