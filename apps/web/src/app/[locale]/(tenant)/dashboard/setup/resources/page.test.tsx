import { screen, waitFor, within } from "@testing-library/react";
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
import ResourcesSetupPage from "./page";

const BAY = {
  id: "r1",
  type: "bay",
  name: "Bay 1",
  capacity: 1,
  active: true,
  room_type: null,
  metadata: { slot_minutes: 60 },
  buffer_minutes: 15,
};

beforeEach(() => {
  fake.reset();
  fake.queue("resources:select", { data: [BAY], error: null });
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

async function removeBay() {
  const row = await screen.findByRole("row", { name: /Bay 1/ });
  expect(within(row).getByText("1 hour")).toBeInTheDocument();
  expect(within(row).getByText("15 min")).toBeInTheDocument();
  await userEvent.click(within(row).getByRole("button", { name: "Remove" }));
  const dialog = await screen.findByRole("alertdialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
}

describe("Setup → Resources (SETTINGS-1 review)", () => {
  it("says the times are off sale only after the route confirms it", async () => {
    const routes = stubRoutes({
      "/api/tenant/resources/r1": () => ({ body: { ok: true, slots_updated: true } }),
    });
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<ResourcesSetupPage />);
    await removeBay();
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Removed — your AI stops offering its times now."),
    );
    expect(routes.calls[0]?.method).toBe("DELETE");
  });

  it("tells the owner nothing changed when the slots couldn't be cleared (retryable)", async () => {
    const routes = stubRoutes({
      "/api/tenant/resources/r1": () => ({ status: 502, body: { error: "slots_not_cleared" } }),
    });
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<ResourcesSetupPage />);
    await removeBay();
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Couldn't remove it — its bookable times couldn't be cleared. Nothing changed; please try again.",
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("explains a member's 403 instead of a generic failure", async () => {
    const routes = stubRoutes({
      "/api/tenant/resources/r1": () => ({
        status: 403,
        body: { error: "owner_or_admin_required" },
      }),
    });
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<ResourcesSetupPage />);
    await removeBay();
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Only an owner or admin can change these settings."),
    );
  });
});
