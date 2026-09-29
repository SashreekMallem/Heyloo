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
import FaqTabPage from "./page";

beforeEach(() => fake.reset());
afterEach(() => vi.unstubAllGlobals());

describe("FaqTabPage (SETTINGS-1)", () => {
  it("rejects a question without an answer and says the FAQ isn't used yet", async () => {
    fake.queue("agent_configs:select", {
      data: {
        dynamic_variable_overrides: { faq_items: [{ question: "Open Sunday?", answer: "" }] },
      },
      error: null,
    });
    const routes = stubRoutes({ "/api/tenant/agent/faq": () => ({ body: { ok: true } }) });
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<FaqTabPage />);
    expect(await screen.findByText(/doesn.t answer from this FAQ/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Answer is required (question 1).");
    expect(routes.calls).toHaveLength(0);
  });

  it("posts valid items to the route", async () => {
    fake.queue("agent_configs:select", {
      data: {
        dynamic_variable_overrides: { faq_items: [{ question: "Open Sunday?", answer: "No." }] },
      },
      error: null,
    });
    const routes = stubRoutes({ "/api/tenant/agent/faq": () => ({ body: { ok: true } }) });
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<FaqTabPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(routes.calls[0]?.body).toEqual({ items: [{ question: "Open Sunday?", answer: "No." }] });
  });
});
