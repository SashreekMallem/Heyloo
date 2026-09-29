import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const { default: PlatformSettingsPage } = await import("./page");

/** Real `GET admin-platform-settings` body for the seeded platform_settings rows. */
const SETTINGS = {
  referral: {
    flat_amount_cents: 20000,
    qualification_rule: "paid_invoices_gte",
    qualification_value: 2,
  },
  price_cards: {},
};

function stubApi() {
  const patches: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        patches.push({ url: String(url), body: JSON.parse(String(init.body)) });
        return Response.json({});
      }
      if (String(url).includes("platform-settings/fees")) return Response.json({ fees: {} });
      return Response.json(SETTINGS);
    }),
  );
  return patches;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PlatformSettingsPage />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

// COCKPIT-F06
describe("Platform settings — referral", () => {
  it("shows the stored flat amount ($200.00), not $0.00", async () => {
    stubApi();
    renderPage();
    expect(await screen.findByLabelText("Flat referral amount")).toHaveValue("200.00");
    expect(screen.getByLabelText("Paid invoices before a referral qualifies")).toHaveValue(2);
  });

  it("saves the amount in cents with the fixed rule and the paid-invoice count", async () => {
    const patches = stubApi();
    renderPage();
    const invoices = await screen.findByLabelText("Paid invoices before a referral qualifies");
    await userEvent.clear(invoices);
    await userEvent.type(invoices, "3");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({
      url: "/api/admin/admin-platform-settings/referral",
      body: {
        flat_amount_cents: 20000,
        qualification_rule: "paid_invoices_gte",
        qualification_value: 3,
      },
    });
  });

  it("refuses to save a count outside 1-24", async () => {
    const patches = stubApi();
    renderPage();
    const invoices = await screen.findByLabelText("Paid invoices before a referral qualifies");
    await userEvent.clear(invoices);
    await userEvent.type(invoices, "0");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(patches).toHaveLength(0);
  });
});
