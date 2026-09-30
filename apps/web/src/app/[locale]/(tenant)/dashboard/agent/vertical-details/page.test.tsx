import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fake } from "@/test/fake-supabase";
import { renderWithTenant, stubRoutes } from "@/test/render-with-tenant";

vi.mock("@/lib/supabase/browser", async () => {
  const { fakeClient } = await import("@/test/fake-supabase");
  return { supabaseBrowserClient: fakeClient() };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import VerticalDetailsTabPage from "./page";

const TENANT = {
  vertical: "auto",
  voice_reminders_enabled: false,
  review_request_enabled: false,
  review_url: null,
  avg_transaction_value_cents: 0,
};

function loadWith(overrides: Record<string, unknown>) {
  fake.queue("tenants:select", { data: TENANT, error: null }, { data: TENANT, error: null });
  fake.queue(
    "agent_configs:select",
    { data: { dynamic_variable_overrides: overrides }, error: null },
    { data: { dynamic_variable_overrides: overrides }, error: null },
  );
}

const POLICY = { window_hours: 24, text: "A $25 fee applies inside 24 hours." };

beforeEach(() => {
  fake.reset();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("VerticalDetailsTabPage — auto (SETTINGS-1 review)", () => {
  it("saves for a shop with NO tow partner on file (the untouched contact used to block every save)", async () => {
    loadWith({ cancellation_policy: POLICY });
    const routes = stubRoutes({
      "/api/tenant/agent/vertical-details": () => ({ body: { ok: true } }),
    });
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<VerticalDetailsTabPage />);
    const makes = await screen.findByLabelText("Vehicle makes serviced (one per line)");
    await userEvent.click(makes);
    await userEvent.paste("Ford");
    await userEvent.click(screen.getAllByRole("button", { name: "Save" })[0] as HTMLElement);
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Saved — your AI uses this from the next call."),
    );
    expect(screen.queryByText(/expected string/)).not.toBeInTheDocument();
    const body = routes.calls[0]?.body as Record<string, unknown>;
    expect(body["tow_partner"]).toBeNull();
    expect(body["vehicle_makes_serviced"]).toEqual(["Ford"]);
  });

  it("asks for the missing half of a contact in plain words, not zod's raw message", async () => {
    loadWith({ cancellation_policy: POLICY });
    const routes = stubRoutes({});
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<VerticalDetailsTabPage />);
    await userEvent.click(await screen.findByLabelText("Tow partner — name"));
    await userEvent.paste("Ace Towing");
    await userEvent.click(screen.getAllByRole("button", { name: "Save" })[0] as HTMLElement);
    expect(await screen.findByText(/Enter a full phone number/)).toBeInTheDocument();
    expect(screen.queryByText(/expected string/)).not.toBeInTheDocument();
    expect(routes.calls).toHaveLength(0);
  });
});

describe("VerticalDetailsTabPage — honest labels (SETTINGS-2)", () => {
  it("cancellation window/fee are stated to callers now; only voice reminders is still labeled unused", async () => {
    loadWith({ cancellation_policy: POLICY });
    vi.stubGlobal("fetch", stubRoutes({}).fetchMock);
    renderWithTenant(<VerticalDetailsTabPage />);
    expect(await screen.findByText(/tells callers the window and fee/)).toBeInTheDocument();
    // Voice reminders has no reader (a reminder call needs Retell outbound calling): still labeled.
    expect(screen.getAllByText("Not used on calls yet")).toHaveLength(1);
    expect(screen.getByText(/Voice appointment reminders/)).toBeInTheDocument();
  });
});

describe("VerticalDetailsTabPage — owner-only (QA-1 F-5 / F-17)", () => {
  it("F-5: a member sees the details read-only — disabled fields, no Save buttons, an explanation", async () => {
    loadWith({ cancellation_policy: POLICY });
    vi.stubGlobal("fetch", stubRoutes({}).fetchMock);
    renderWithTenant(<VerticalDetailsTabPage />, { canWrite: false });
    expect(await screen.findByTestId("read-only-note")).toBeInTheDocument();
    expect(await screen.findByLabelText("Vehicle makes serviced (one per line)")).toBeDisabled();
    expect(screen.getByLabelText("Review link")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("F-17: a cancellation window over a year is rejected before posting", async () => {
    loadWith({ cancellation_policy: POLICY });
    const routes = stubRoutes({});
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<VerticalDetailsTabPage />);
    const window = await screen.findByLabelText("Cancellation window (hours)");
    await userEvent.clear(window);
    await userEvent.type(window, "999999");
    await userEvent.click(screen.getAllByRole("button", { name: "Save" })[0] as HTMLElement);
    expect(await screen.findByText(/Keep the window to a year/)).toBeInTheDocument();
    expect(routes.calls).toHaveLength(0);
  });

  it("F-17: an http:// review link is rejected (the message says https://)", async () => {
    loadWith({ cancellation_policy: POLICY });
    const routes = stubRoutes({});
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<VerticalDetailsTabPage />);
    const link = await screen.findByLabelText("Review link");
    await userEvent.type(link, "http://g.page/r/abc");
    await userEvent.click(screen.getAllByRole("button", { name: "Save" })[1] as HTMLElement);
    expect(await screen.findByText(/full link starting with https:\/\//)).toBeInTheDocument();
    expect(routes.calls).toHaveLength(0);
  });
});
