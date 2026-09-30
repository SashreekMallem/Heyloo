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
    });
    // QA-1 F-18: the server-rendered header name must refresh after a rename.
    expect(refresh).toHaveBeenCalledTimes(1);
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
