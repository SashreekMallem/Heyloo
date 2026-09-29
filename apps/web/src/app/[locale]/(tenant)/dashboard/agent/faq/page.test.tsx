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
  it("rejects a question without an answer, and tells the owner the FAQ is used on calls now (SETTINGS-2)", async () => {
    fake.queue("agent_configs:select", {
      data: {
        dynamic_variable_overrides: { faq_items: [{ question: "Open Sunday?", answer: "" }] },
      },
      error: null,
    });
    const routes = stubRoutes({ "/api/tenant/agent/faq": () => ({ body: { ok: true } }) });
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<FaqTabPage />);
    expect(
      await screen.findByText(/answers callers and texters from these questions/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Saved, but not used yet/)).not.toBeInTheDocument();
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

describe("FaqTabPage: how much the AI reads (SETTINGS-2)", () => {
  it("warns when more of the FAQ is stored than the AI reads on a call", async () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      question: `Question ${i}?`,
      answer: "Yes.",
    }));
    fake.queue("agent_configs:select", {
      data: { dynamic_variable_overrides: { faq_items: items } },
      error: null,
    });
    vi.stubGlobal("fetch", stubRoutes({}).fetchMock);
    renderWithTenant(<FaqTabPage />);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "currently reads the first 25 of your 30 questions",
    );
  });

  it("stays quiet when everything fits", async () => {
    fake.queue("agent_configs:select", {
      data: { dynamic_variable_overrides: { faq_items: [{ question: "Open?", answer: "Yes." }] } },
      error: null,
    });
    vi.stubGlobal("fetch", stubRoutes({}).fetchMock);
    renderWithTenant(<FaqTabPage />);
    await screen.findByRole("button", { name: "Save" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
