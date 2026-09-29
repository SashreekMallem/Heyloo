import { fireEvent, screen, waitFor } from "@testing-library/react";
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
import HoursTabPage from "./page";

/** SIGNUP-1 Test Auto's live row: the legacy `closed: true` Sunday that was still bookable. */
const LIVE_ROW = {
  business_hours: {
    mon: [{ open: "08:00", close: "18:00", closed: false }],
    tue: [{ open: "08:00", close: "18:00", closed: false }],
    wed: [{ open: "08:00", close: "18:00", closed: false }],
    thu: [{ open: "08:00", close: "18:00", closed: false }],
    fri: [{ open: "08:00", close: "18:00", closed: false }],
    sat: [{ open: "09:00", close: "13:00", closed: false }],
    sun: [{ open: "09:00", close: "13:00", closed: true }],
  },
  hours_exceptions: [{ date: "2026-11-26", note: "Thanksgiving", closed: true }],
  timezone: "America/New_York",
  vertical: "auto",
};

beforeEach(() => {
  fake.reset();
  fake.queue("tenants:select", { data: LIVE_ROW, error: null });
});
afterEach(() => vi.unstubAllGlobals());

function stub() {
  const routes = stubRoutes({
    "/api/tenant/settings/hours": () => ({
      body: { ok: true, availability: { resources: 2, failed: 0 } },
    }),
    "/api/tenant/settings/booking-rules": () => ({
      body: { available: false, min_notice_minutes: null, horizon_days: null },
    }),
  });
  vi.stubGlobal("fetch", routes.fetchMock);
  return routes;
}

describe("HoursTabPage (SETTINGS-1)", () => {
  it("saves the canonical shape — the legacy closed Sunday becomes []", async () => {
    const routes = stub();
    renderWithTenant(<HoursTabPage />);
    expect(await screen.findByRole("checkbox", { name: "Sunday closed" })).toBeChecked();
    expect(screen.getByText(/America\/New_York/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save hours" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Saved — your bookable times are updated now."),
    );
    const post = routes.calls.find((c) => c.url.endsWith("/api/tenant/settings/hours"));
    expect(post?.body).toMatchObject({
      hours: { sun: { closed: true }, sat: { closed: false } },
      exceptions: [{ date: "2026-11-26", closed: true, note: "Thanksgiving" }],
    });
  });

  it("blocks a blank holiday date and a backwards time range before posting", async () => {
    const routes = stub();
    renderWithTenant(<HoursTabPage />);
    await screen.findByRole("checkbox", { name: "Sunday closed" });
    await userEvent.click(screen.getByRole("button", { name: /Add a date/ }));
    fireEvent.change(screen.getByLabelText("Monday closing time"), { target: { value: "07:00" } });
    await userEvent.click(screen.getByRole("button", { name: "Save hours" }));
    expect(await screen.findByText("Pick a date.")).toBeInTheDocument();
    expect(screen.getByText(/Closing time must be after opening time/)).toBeInTheDocument();
    expect(routes.calls.some((c) => c.url.endsWith("/api/tenant/settings/hours"))).toBe(false);
  });

  it("says the booking window arrives later when the migration isn't applied", async () => {
    stub();
    renderWithTenant(<HoursTabPage />);
    expect(await screen.findByText(/arrive with the next platform update/)).toBeInTheDocument();
  });
});
