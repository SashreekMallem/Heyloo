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
