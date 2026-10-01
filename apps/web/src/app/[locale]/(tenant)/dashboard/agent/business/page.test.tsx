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
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import BusinessTabPage from "./page";

beforeEach(() => {
  refresh.mockClear();
  fake.reset();
  fake.queue("tenants:select", {
    data: { name: "SIGNUP-1 Test Auto", timezone: "America/New_York", retention_days: 30 },
    error: null,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("BusinessTabPage (SETTINGS-1)", () => {
  it("renames the business and reports the save", async () => {
    const routes = stubRoutes({
      "/api/tenant/settings/business": () => ({ body: { ok: true, timezone_changed: false } }),
    });
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<BusinessTabPage />);
    const name = await screen.findByLabelText("Business name");
    expect(screen.getByText(/30 days/)).toBeInTheDocument();
    await userEvent.clear(name);
    await userEvent.click(name);
    await userEvent.paste("Riverside Auto Repair");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Saved — your AI uses the new name from the next call.",
      ),
    );
    expect(routes.calls[0]?.body).toEqual({
      name: "Riverside Auto Repair",
      timezone: "America/New_York",
      business_phone: "",
      website_url: "",
      business_street: "",
      business_city: "",
      business_state: "",
      business_zip: "",
    });
    // QA-1 F-18: the server-rendered header name must refresh after a rename.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows the stored business phone formatted and saves an edited phone + website", async () => {
    fake.reset();
    fake.queue("tenants:select", {
      data: {
        name: "Riverside Auto",
        timezone: "America/New_York",
        retention_days: 30,
        business_phone: "+12627551967",
        website_url: "https://riverside.example",
      },
      error: null,
    });
    const routes = stubRoutes({
      "/api/tenant/settings/business": () => ({ body: { ok: true, timezone_changed: false } }),
    });
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<BusinessTabPage />);
    const phone = await screen.findByLabelText("Business phone number");
    expect(phone).toHaveValue("(262) 755-1967");
    expect(screen.getByLabelText("Website (optional)")).toHaveValue("https://riverside.example");
    await userEvent.clear(phone);
    await userEvent.click(phone);
    await userEvent.paste("414-555-0100");
    const website = screen.getByLabelText("Website (optional)");
    await userEvent.clear(website);
    await userEvent.click(website);
    await userEvent.paste("riverside.com");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(routes.calls).toHaveLength(1));
    // Normalized on blur for display; the route normalizes again server-side.
    expect(routes.calls[0]?.body).toMatchObject({
      business_phone: "(414) 555-0100",
      website_url: "https://riverside.com",
    });
  });

  it("rejects an invalid business phone inline", async () => {
    const routes = stubRoutes({});
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<BusinessTabPage />);
    const phone = await screen.findByLabelText("Business phone number");
    await userEvent.click(phone);
    await userEvent.paste("555-0100");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/US or Canadian business number/)).toBeInTheDocument();
    expect(routes.calls).toHaveLength(0);
  });

  it("rejects a one-letter name inline", async () => {
    const routes = stubRoutes({});
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<BusinessTabPage />);
    const name = await screen.findByLabelText("Business name");
    await userEvent.clear(name);
    await userEvent.click(name);
    await userEvent.paste("R");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Enter your business name/)).toBeInTheDocument();
    expect(routes.calls).toHaveLength(0);
  });

  it("can pick any IANA zone from the full list and saves it", async () => {
    const routes = stubRoutes({
      "/api/tenant/settings/business": () => ({ body: { ok: true, timezone_changed: true } }),
    });
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<BusinessTabPage />);
    await userEvent.click(await screen.findByRole("button", { name: /Show all time zones/ }));
    await userEvent.selectOptions(screen.getByLabelText("Time zone"), "America/Boise");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Saved — your bookable times were rebuilt in the new time zone.",
      ),
    );
    expect(routes.calls[0]?.body).toEqual({
      name: "SIGNUP-1 Test Auto",
      timezone: "America/Boise",
      business_phone: "",
      website_url: "",
      business_street: "",
      business_city: "",
      business_state: "",
      business_zip: "",
    });
  });

  it("SETTINGS-1 review: says 'overnight' when the slot rebuild failed", async () => {
    const routes = stubRoutes({
      "/api/tenant/settings/business": () => ({
        body: { ok: true, timezone_changed: true, availability: { resources: 0, failed: 1 } },
      }),
    });
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<BusinessTabPage />);
    await userEvent.click(await screen.findByRole("button", { name: /Show all time zones/ }));
    await userEvent.selectOptions(screen.getByLabelText("Time zone"), "America/Boise");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Saved — your bookable times finish moving to the new time zone overnight.",
      ),
    );
  });

  it("SETTINGS-1 review: shows the server's 'zone not supported' error under the picker", async () => {
    const routes = stubRoutes({
      "/api/tenant/settings/business": () => ({
        status: 422,
        body: {
          error: "invalid_request",
          issues: [{ path: ["timezone"], message: "This time zone isn't supported yet." }],
        },
      }),
    });
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<BusinessTabPage />);
    await userEvent.click(await screen.findByRole("button", { name: /Show all time zones/ }));
    await userEvent.selectOptions(screen.getByLabelText("Time zone"), "America/Boise");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("This time zone isn't supported yet.")).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith("Please fix the highlighted fields.");
  });
});

describe("BusinessTabPage — address and delivery (DELIVERY-1)", () => {
  function restaurantRow(overrides: Record<string, unknown> = {}) {
    return {
      name: "Taco Town",
      timezone: "America/Chicago",
      retention_days: 30,
      vertical: "restaurant",
      business_street: "400 N Greenville Ave",
      business_city: "Richardson",
      business_state: "TX",
      business_zip: "75081",
      business_lat: 32.95,
      business_lng: -96.73,
      business_location_matched: "400 N GREENVILLE AVE, RICHARDSON, TX, 75081",
      delivery_radius_miles: 5,
      delivery_fee_base_cents: 300,
      delivery_fee_per_mile_cents: 100,
      delivery_fee_included_miles: 2,
      delivery_min_order_cents: 1500,
      ...overrides,
    };
  }

  it("non-restaurant tenants see the address but no Delivery group, and never send delivery fields", async () => {
    const routes = stubRoutes({
      "/api/tenant/settings/business": () => ({ body: { ok: true, timezone_changed: false } }),
    });
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<BusinessTabPage />);
    expect(await screen.findByLabelText("Street address")).toBeInTheDocument();
    expect(screen.queryByLabelText("Delivery radius (miles)")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(routes.calls).toHaveLength(1));
    expect(Object.keys(routes.calls[0]?.body as object)).not.toContain("delivery_fee_base");
  });

  it("restaurant: shows the stored location, delivery fields in dollars, and a live fee example", async () => {
    fake.reset();
    fake.queue("tenants:select", { data: restaurantRow(), error: null });
    vi.stubGlobal("fetch", stubRoutes({}).fetchMock);
    renderWithTenant(<BusinessTabPage />);
    expect(await screen.findByLabelText("Delivery radius (miles)")).toHaveValue("5");
    expect(screen.getByLabelText("Base delivery fee ($)")).toHaveValue("3.00");
    expect(screen.getByLabelText("Fee per extra mile ($)")).toHaveValue("1.00");
    expect(screen.getByLabelText("Miles included in base fee")).toHaveValue("2");
    expect(screen.getByLabelText("Minimum order for delivery ($)")).toHaveValue("15.00");
    expect(
      screen.getByText("Located: 400 N GREENVILLE AVE, RICHARDSON, TX, 75081"),
    ).toBeInTheDocument();
    // 300 + ceil(100 * (5 - 2)) = $6.00 at the 5-mile radius.
    expect(screen.getByTestId("delivery-fee-example")).toHaveTextContent(
      "A 5-mile delivery costs $6.00.",
    );
    const perMile = screen.getByLabelText("Fee per extra mile ($)");
    await userEvent.clear(perMile);
    await userEvent.click(perMile);
    await userEvent.paste("1.50");
    expect(screen.getByTestId("delivery-fee-example")).toHaveTextContent(
      "A 5-mile delivery costs $7.50.",
    );
  });

  it("restaurant: saves the address + delivery fields and shows where the address was located", async () => {
    fake.reset();
    const unlocated = restaurantRow({
      business_lat: null,
      business_lng: null,
      business_location_matched: null,
    });
    // The save invalidates the query; the refetch returns the row again.
    fake.queue(
      "tenants:select",
      { data: unlocated, error: null },
      { data: unlocated, error: null },
    );
    const routes = stubRoutes({
      "/api/tenant/settings/business": () => ({
        body: {
          ok: true,
          timezone_changed: false,
          business_location: {
            matched_address: "500 MAIN ST, RICHARDSON, TX, 75081",
            lat: 32.9,
            lng: -96.7,
          },
        },
      }),
    });
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<BusinessTabPage />);
    const street = await screen.findByLabelText("Street address");
    await userEvent.clear(street);
    await userEvent.click(street);
    await userEvent.paste("500 Main St");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("Located: 500 MAIN ST, RICHARDSON, TX, 75081"),
    ).toBeInTheDocument();
    expect(routes.calls[0]?.body).toMatchObject({
      business_street: "500 Main St",
      business_city: "Richardson",
      business_state: "TX",
      business_zip: "75081",
      delivery_radius_miles: "5",
      delivery_fee_base: "3.00",
      delivery_fee_per_mile: "1.00",
      delivery_fee_included_miles: "2",
      delivery_min_order: "15.00",
    });
  });

  it("warns clearly when the saved address could not be found", async () => {
    fake.reset();
    fake.queue(
      "tenants:select",
      { data: restaurantRow(), error: null },
      { data: restaurantRow(), error: null },
    );
    const routes = stubRoutes({
      "/api/tenant/settings/business": () => ({
        body: { ok: true, timezone_changed: false, business_location: { error: "not_found" } },
      }),
    });
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<BusinessTabPage />);
    const street = await screen.findByLabelText("Street address");
    await userEvent.clear(street);
    await userEvent.click(street);
    await userEvent.paste("1 Nowhere Rd");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't find this address — check it.",
    );
  });

  it("rejects a negative fee, more than 2 decimals, a bad state and a 500-mile radius inline", async () => {
    fake.reset();
    fake.queue("tenants:select", { data: restaurantRow(), error: null });
    const routes = stubRoutes({});
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<BusinessTabPage />);
    const set = async (label: string, value: string) => {
      const input = await screen.findByLabelText(label);
      await userEvent.clear(input);
      await userEvent.click(input);
      await userEvent.paste(value);
    };
    await set("Base delivery fee ($)", "-2");
    await set("Fee per extra mile ($)", "1.255");
    await set("Delivery radius (miles)", "500");
    await set("State", "T1");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("This can't be negative.")).toBeInTheDocument();
    expect(screen.getByText("Use at most 2 decimals.")).toBeInTheDocument();
    expect(screen.getByText("Enter a radius between 0.1 and 100 miles.")).toBeInTheDocument();
    expect(screen.getByText("Use the 2-letter state code, e.g. TX.")).toBeInTheDocument();
    expect(routes.calls).toHaveLength(0);
  });
});
