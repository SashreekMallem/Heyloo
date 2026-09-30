import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fake } from "@/test/fake-supabase";
import { renderWithTenant, stubRoutes } from "@/test/render-with-tenant";

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
import ServicesTabPage from "./page";

const OIL_CHANGE = {
  id: "o1",
  name: "Oil change",
  duration_minutes: 30,
  price_cents: 4999,
  active: true,
};

beforeEach(() => {
  fake.reset();
  fake.queue("offerings:select", { data: [OIL_CHANGE], error: null }, { data: [], error: null });
});
afterEach(() => vi.unstubAllGlobals());

describe("ServicesTabPage (SETTINGS-1)", () => {
  it("validates the length inline, then creates through the server route", async () => {
    const routes = stubRoutes({
      "/api/tenant/offerings": () => ({ body: { ok: true, id: "o2" } }),
    });
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<ServicesTabPage />);
    await userEvent.click(await screen.findByRole("button", { name: /Add service/ }));
    await userEvent.click(screen.getByLabelText("Name"));
    await userEvent.paste("Brake check");
    await userEvent.click(screen.getByLabelText("Length (minutes)"));
    await userEvent.paste("3");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("At least 5 minutes.")).toBeInTheDocument();
    expect(routes.calls).toHaveLength(0);

    await userEvent.clear(screen.getByLabelText("Length (minutes)"));
    await userEvent.click(screen.getByLabelText("Length (minutes)"));
    await userEvent.paste("45");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(routes.calls[0]).toMatchObject({
      method: "POST",
      body: { name: "Brake check", duration_minutes: 45 },
    });
  });

  it("QA-1 F-14: lists only active services (a removed one no longer shows as a dead-end 'Inactive' row)", async () => {
    renderWithTenant(<ServicesTabPage />);
    expect((await screen.findAllByText("Oil change")).length).toBeGreaterThan(0);
    const select = fake.callsTo("offerings", "select")[0];
    expect(select?.filters).toContainEqual(["eq", "active", true]);
    expect(screen.queryByText("Inactive")).not.toBeInTheDocument();
  });

  it("QA-1 F-5: a member sees the services but no Add/Edit/Delete, with an explanation", async () => {
    renderWithTenant(<ServicesTabPage />, { canWrite: false });
    expect(await screen.findByTestId("read-only-note")).toBeInTheDocument();
    expect((await screen.findAllByText("Oil change")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Add service/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit Oil change/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete Oil change/ })).not.toBeInTheDocument();
  });

  it("asks before removing and reports the result", async () => {
    const routes = stubRoutes({ "/api/tenant/offerings/o1": () => ({ body: { ok: true } }) });
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<ServicesTabPage />);
    await userEvent.click(
      (await screen.findAllByRole("button", { name: "Delete Oil change" }))[0]!,
    );
    expect(routes.calls).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(routes.calls[0]?.method).toBe("DELETE"));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("SETTINGS-1 review: emptying the length and price on an edit clears them (null), not 'Saved' with the old values", async () => {
    const routes = stubRoutes({ "/api/tenant/offerings/o1": () => ({ body: { ok: true } }) });
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<ServicesTabPage />);
    await userEvent.click((await screen.findAllByRole("button", { name: "Edit Oil change" }))[0]!);
    expect(screen.getByLabelText("Price")).toHaveValue("49.99");
    await userEvent.clear(screen.getByLabelText("Length (minutes)"));
    await userEvent.clear(screen.getByLabelText("Price"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(routes.calls).toHaveLength(1));
    expect(routes.calls[0]).toMatchObject({
      method: "PATCH",
      body: { name: "Oil change", duration_minutes: null, price_cents: null },
    });
  });
});
