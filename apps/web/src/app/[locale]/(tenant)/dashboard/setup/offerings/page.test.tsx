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
import OfferingsSetupPage from "./page";

const PIZZA = {
  id: "o1",
  name: "Margherita",
  category: "Pizza",
  duration_minutes: 20,
  price_cents: 1400,
  resource_type_required: null,
  metadata: { modifiers: [{ name: "Extra cheese", price_cents: 200 }], allergens: ["dairy"] },
  active: true,
};

beforeEach(() => {
  fake.reset();
  fake.queue("offerings:select", { data: [PIZZA], error: null }, { data: [PIZZA], error: null });
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("Setup → Offerings dialog (QA-1 F-1)", () => {
  it("opens the Add dialog without crashing (FormLabel outside FormField used to throw)", async () => {
    renderWithTenant(<OfferingsSetupPage />);
    await userEvent.click((await screen.findAllByRole("button", { name: /Add offering/ }))[0]!);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Modifiers")).toBeInTheDocument();
  });

  it("opens the Edit dialog prefilled with modifiers", async () => {
    renderWithTenant(<OfferingsSetupPage />);
    await userEvent.click((await screen.findAllByRole("button", { name: "Edit Margherita" }))[0]!);
    expect(await screen.findByDisplayValue("Extra cheese")).toBeInTheDocument();
    expect(screen.getByText("Modifiers")).toBeInTheDocument();
  });

  it("sends null for an emptied price/duration on edit so the value is really cleared", async () => {
    const routes = stubRoutes({ "/api/tenant/offerings/o1": () => ({ body: { ok: true } }) });
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<OfferingsSetupPage />);
    await userEvent.click((await screen.findAllByRole("button", { name: "Edit Margherita" }))[0]!);
    const dialog = await screen.findByRole("dialog");
    const duration = dialog.querySelector('input[type="number"]') as HTMLInputElement;
    await userEvent.clear(duration);
    await userEvent.clear(screen.getByLabelText("Price"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(routes.calls).toHaveLength(1));
    expect(routes.calls[0]?.method).toBe("PATCH");
    expect(routes.calls[0]?.body).toMatchObject({ duration_minutes: null, price_cents: null });
  });

  it("QA-1 F-5: a member sees the menu read-only (no Add/Import/Edit/Remove), with an explanation", async () => {
    renderWithTenant(<OfferingsSetupPage />, { canWrite: false });
    expect(await screen.findByTestId("read-only-note")).toBeInTheDocument();
    expect((await screen.findAllByText("Margherita")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Add offering/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Import menu/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit Margherita/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove Margherita/ })).not.toBeInTheDocument();
  });

  it("a new offering omits an empty price/duration (create schema has no null)", async () => {
    const routes = stubRoutes({
      "/api/tenant/offerings": () => ({ body: { ok: true, id: "o2" } }),
    });
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<OfferingsSetupPage />);
    await userEvent.click((await screen.findAllByRole("button", { name: /Add offering/ }))[0]!);
    await userEvent.click(screen.getByPlaceholderText(/Oil change/));
    await userEvent.paste("Soup");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(routes.calls).toHaveLength(1));
    const body = routes.calls[0]?.body as Record<string, unknown>;
    expect(body["price_cents"] ?? null).toBeNull();
    expect(body).not.toHaveProperty("duration_minutes", null);
  });
});
