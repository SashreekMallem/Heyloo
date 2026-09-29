import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake } from "@/test/fake-supabase";
import { renderWithTenant } from "@/test/render-with-tenant";

vi.mock("@/lib/supabase/browser", async () => {
  const { fakeClient } = await import("@/test/fake-supabase");
  return { supabaseBrowserClient: fakeClient() };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import ManualModeTabPage from "./page";

beforeEach(() => {
  fake.reset();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe("Agent → Manual Mode", () => {
  it("QA-1 F-5: turning it on when RLS drops the write is an error, not 'Manual Mode is on'", async () => {
    fake.queue("tenants:select", { data: { manual_mode: false, manual_mode_enabled_at: null } });
    fake.queue("tenants:update", { data: [], error: null });
    renderWithTenant(<ManualModeTabPage />);
    await userEvent.click(await screen.findByRole("switch", { name: "Manual Mode" }));
    await userEvent.click(await screen.findByRole("button", { name: "Turn on Manual Mode" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Only an owner or admin can change this."),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("turns it on for an owner and says so", async () => {
    fake.queue("tenants:select", { data: { manual_mode: false, manual_mode_enabled_at: null } });
    fake.queue("tenants:update", { data: [{ id: "t1" }], error: null });
    renderWithTenant(<ManualModeTabPage />);
    await userEvent.click(await screen.findByRole("switch", { name: "Manual Mode" }));
    await userEvent.click(await screen.findByRole("button", { name: "Turn on Manual Mode" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(fake.callsTo("tenants", "update")[0]?.payload).toMatchObject({ manual_mode: true });
  });

  it("QA-1 F-5: a member sees the state but the switch is disabled and there is no 'Turn off' shortcut", async () => {
    fake.queue("tenants:select", {
      data: { manual_mode: true, manual_mode_enabled_at: "2026-09-29T12:00:00Z" },
    });
    renderWithTenant(<ManualModeTabPage />, { canWrite: false });
    expect(await screen.findByTestId("read-only-note")).toBeInTheDocument();
    const toggle = await screen.findByRole("switch", { name: "Manual Mode" });
    expect(toggle).toBeDisabled();
    expect(toggle).toBeChecked();
    expect(screen.queryByRole("button", { name: "Turn off" })).not.toBeInTheDocument();
  });
});
