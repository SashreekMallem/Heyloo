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
import InstructionsTabPage from "./page";

beforeEach(() => {
  fake.reset();
  fake.queue("agent_configs:select", {
    data: {
      special_instructions: "Ask if the car is driveable.",
      transfer_number: "+16105550122",
      dynamic_variable_overrides: {
        manager_name: "Sam",
        accepted_payment_types: ["Cash", "Card"],
        call_routing: { transfer_window: "business_hours", transfer_urgent: true },
      },
    },
    error: null,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("InstructionsTabPage (SETTINGS-1)", () => {
  it("loads saved values, marks unread fields honestly", async () => {
    vi.stubGlobal("fetch", stubRoutes({}).fetchMock);
    renderWithTenant(<InstructionsTabPage />);
    expect(await screen.findByLabelText("Transfer number")).toHaveValue("(610) 555-0122");
    expect(screen.getByLabelText("Payment types you accept")).toHaveValue("Cash, Card");
    expect(screen.getAllByText("Not used on calls yet").length).toBeGreaterThan(0);
  });

  it("can REMOVE a saved transfer number (blank is posted, not rejected)", async () => {
    const routes = stubRoutes({ "/api/tenant/agent/instructions": () => ({ body: { ok: true } }) });
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<InstructionsTabPage />);
    await screen.findByLabelText("Transfer number");
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(routes.calls[0]?.body).toMatchObject({
      transfer_number: "",
      accepted_payment_types: ["Cash", "Card"],
      call_routing: { transfer_window: "business_hours", transfer_urgent: true },
    });
  });

  it("shows a friendly inline error for a partial phone number", async () => {
    const routes = stubRoutes({ "/api/tenant/agent/instructions": () => ({ body: { ok: true } }) });
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<InstructionsTabPage />);
    const input = await screen.findByLabelText("Transfer number");
    await userEvent.clear(input);
    await userEvent.click(input);
    await userEvent.paste("610555");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Enter a full phone number/)).toBeInTheDocument();
    expect(routes.calls).toHaveLength(0);
  });
});
