import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TenantIdProvider } from "@/lib/tenant/tenant-context";
import { fake } from "@/test/fake-supabase";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() },
}));

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

  it("CAL-1: the Google Calendar card says what it does and when busy times were last updated", async () => {
    const checked = new Date(Date.now() - 2 * 60_000).toISOString();
    stubIntegrations([
      integration({
        provider: "google_calendar",
        display_name: "Google Calendar",
        status: "connected",
        available: true,
        last_checked_at: checked,
      }),
    ]);
    renderPage();
    expect(await screen.findByText("Google Calendar")).toBeInTheDocument();
    const card = cardFor("Google Calendar");
    expect(
      within(card).getByText(
        "Reads your busy times so the AI never double-books, and adds Heyloo bookings to your calendar.",
      ),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(
        new RegExp(`Last updated ${escapeRegExp(new Date(checked).toLocaleString())}`),
      ),
    ).toBeInTheDocument();
    // CAL-1b: push-only — no "every few minutes" promise
    expect(
      within(card).getByText(/Changes in your calendar reach Heyloo within about a minute\./),
    ).toBeInTheDocument();
    expect(within(card).queryByText(/few minutes|5 minutes/)).not.toBeInTheDocument();
    expect(within(card).queryByText("Coming soon")).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Disconnect" })).toBeEnabled();
  });

  it("CAL-1: a freshly connected calendar says the first read is on its way", async () => {
    stubIntegrations([
      integration({
        provider: "google_calendar",
        display_name: "Google Calendar",
        status: "connected",
        available: true,
        last_checked_at: null,
      }),
    ]);
    renderPage();
    expect(
      await screen.findByText(
        "Connected. Reading your busy times for the first time — this takes about a minute.",
      ),
    ).toBeInTheDocument();
  });

  it("CAL-1b: an old last update is normal (push-only) — no trouble note while reads succeed", async () => {
    stubIntegrations([
      integration({
        provider: "google_calendar",
        display_name: "Google Calendar",
        status: "connected",
        available: true,
        last_checked_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        calendar_read_failing: false,
      }),
    ]);
    renderPage();
    expect(
      await screen.findByText(/Changes in your calendar reach Heyloo within about a minute/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/having trouble reading your calendar/)).not.toBeInTheDocument();
  });

  it("CAL-1b: a failing read is shown honestly", async () => {
    stubIntegrations([
      integration({
        provider: "google_calendar",
        display_name: "Google Calendar",
        status: "connected",
        available: true,
        last_checked_at: new Date(Date.now() - 10 * 60_000).toISOString(),
        calendar_read_failing: true,
      }),
    ]);
    renderPage();
    expect(await screen.findByText(/having trouble reading your calendar/)).toBeInTheDocument();
  });

  it("CAL-1b: a first read that is failing says so too", async () => {
    stubIntegrations([
      integration({
        provider: "google_calendar",
        display_name: "Google Calendar",
        status: "connected",
        available: true,
        last_checked_at: null,
        calendar_read_failing: true,
      }),
    ]);
    renderPage();
    expect(
      await screen.findByText(
        "Connected. Heyloo is having trouble reading your calendar and will keep trying.",
      ),
    ).toBeInTheDocument();
  });

  it("CAL-1: a not-connected Google Calendar can be connected (no longer Coming soon)", async () => {
    stubIntegrations([
      integration({
        provider: "google_calendar",
        display_name: "Google Calendar",
        available: true,
      }),
    ]);
    renderPage();
    expect(await screen.findByText("Google Calendar")).toBeInTheDocument();
    const card = cardFor("Google Calendar");
    expect(within(card).queryByText("Coming soon")).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Connect" })).toBeEnabled();
  });

  it("CAL-1: a consent with a permission unticked gets a specific message", async () => {
    stubIntegrations([]);
    renderPage();
    await screen.findByText("Send bookings & orders to any app");
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: {
          source: "heyloo-adapter-oauth",
          ok: false,
          provider: "google_calendar",
          error: "google_scopes_not_granted",
        },
      }),
    );
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("needs both permissions"));
  });
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
