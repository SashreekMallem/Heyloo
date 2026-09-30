import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake } from "@/test/fake-supabase";
import { renderWithTenant } from "@/test/render-with-tenant";

vi.mock("@/lib/supabase/browser", async () => {
  const { fakeClient } = await import("@/test/fake-supabase");
  return { supabaseBrowserClient: fakeClient() };
});
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import GreetingTabPage from "./page";

beforeEach(() => {
  fake.reset();
  fake.queue("tenants:select", {
    data: { name: "Acme Auto", language_config: { primary: "en" } },
    error: null,
  });
  fake.queue("agent_configs:select", { data: { assistant_name: "Nova" }, error: null });
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe("Agent → Greeting", () => {
  it("QA-1 F-9: a blank assistant name saves as null (callers hear the default) instead of an error", async () => {
    fake.queue("agent_configs:update", { data: [{ tenant_id: "t1" }], error: null });
    renderWithTenant(<GreetingTabPage />);
    const input = await screen.findByLabelText("AI assistant name");
    await waitFor(() => expect(input).toHaveValue("Nova"));
    await userEvent.clear(input);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(screen.queryByText(/Give your AI assistant a name/)).not.toBeInTheDocument();
    expect(fake.callsTo("agent_configs", "update")[0]?.payload).toEqual({ assistant_name: null });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("QA-1 F-5: a write filtered to zero rows is an error toast, never 'Saved'", async () => {
    fake.queue("agent_configs:update", { data: [], error: null });
    renderWithTenant(<GreetingTabPage />);
    const input = await screen.findByLabelText("AI assistant name");
    await waitFor(() => expect(input).toHaveValue("Nova"));
    await userEvent.type(input, "x");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Only an owner or admin can change this."),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("QA-1 F-5: a member gets a read-only form with an explanation and no Save button", async () => {
    renderWithTenant(<GreetingTabPage />, { canWrite: false });
    expect(await screen.findByTestId("read-only-note")).toBeInTheDocument();
    expect(screen.getByLabelText("AI assistant name")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });
});
