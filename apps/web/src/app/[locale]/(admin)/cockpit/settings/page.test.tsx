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

function stubApi(settings: unknown = SETTINGS) {
  const patches: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        patches.push({ url: String(url), body: JSON.parse(String(init.body)) });
        return Response.json({});
      }
      if (String(url).includes("platform-settings/fees")) return Response.json({ fees: {} });
      return Response.json(settings);
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

// COCKPIT-F06 (round 2): the web build can reach an admin edge function that
// has not been redeployed yet. That older function answers with no
// `qualification_value` and a flat amount of 0 for the seeded
// `{flat_amount_cents: 20000}` row; showing $0.00 and letting Save write it
// would silently wipe the real amount.
describe("Platform settings — referral against a stale admin edge function", () => {
  const STALE = {
    referral: { flat_amount_cents: 0, qualification_rule: "" },
    price_cards: {},
  };

  it("does not render an editable $0.00 amount or a Save button", async () => {
    const patches = stubApi(STALE);
    renderPage();
    expect(await screen.findByText(/referral settings are unavailable/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Flat referral amount")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(patches).toHaveLength(0);
  });

  it("treats a response with no referral block the same way", async () => {
    stubApi({ price_cards: {} });
    renderPage();
    expect(await screen.findByText(/referral settings are unavailable/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("still accepts a legitimately stored $0.00 from the current function", async () => {
    stubApi({
      referral: {
        flat_amount_cents: 0,
        qualification_rule: "paid_invoices_gte",
        qualification_value: 2,
      },
      price_cards: {},
    });
    renderPage();
    expect(await screen.findByLabelText("Flat referral amount")).toHaveValue("0.00");
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });
});

// COCKPIT-F03
describe("Platform settings — fees read failure", () => {
  it("shows a human error with Retry in the Fees tab instead of an empty panel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("platform-settings/fees")) {
          return Response.json({ error: "admin_query_failed" }, { status: 500 });
        }
        return Response.json(SETTINGS);
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("tab", { name: "Fees" }));
    expect(await screen.findByText("Something went wrong. Please retry.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByText(/admin_query_failed/)).not.toBeInTheDocument();
  });
});
