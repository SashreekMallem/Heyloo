import { screen, waitFor, within } from "@testing-library/react";
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
import { WebsiteWidgetClient } from "./website-widget-client";

interface TenantRow {
  widget_enabled: boolean;
  widget_settings: Record<string, unknown>;
  widget_public_key: string | null;
}

const SETTINGS_ROUTE = "/api/tenant/settings/widget";
const ROTATE_ROUTE = "/api/tenant/settings/widget/rotate-key";

function seed(row: TenantRow) {
  fake.queue("tenants:select", { data: row, error: null });
  fake.queue("usage_daily:select", {
    data: [{ text_messages_out: 4 }, { text_messages_out: 6 }],
    error: null,
  });
}

function renderClient(options?: { canWrite?: boolean }) {
  return renderWithTenant(<WebsiteWidgetClient tenantId="t1" />, options);
}

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe("WebsiteWidgetClient", () => {
  beforeEach(() => {
    fake.reset();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // Not a query against rendered test output — cleans up the <script>
    // element the component's own preview effect appends directly to
    // `document.body` (outside RTL's container), the same way the
    // component's own unmount cleanup does.
    // eslint-disable-next-line testing-library/no-node-access
    document.getElementById("heyloo-widget-host")?.remove();
    // eslint-disable-next-line testing-library/no-node-access
    document.querySelectorAll("script[data-heyloo-widget-preview]").forEach((n) => {
      n.remove();
    });
  });

  it("prompts to generate a key when none exists yet, and shows no snippet", async () => {
    seed({ widget_enabled: false, widget_settings: {}, widget_public_key: null });
    renderClient();
    expect(await screen.findByText(/Generate a public key/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Copy snippet")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate key/ })).toBeInTheDocument();
  });

  it("shows the embed snippet with the existing public key", async () => {
    seed({
      widget_enabled: true,
      widget_settings: { allowed_origins: ["https://acme.example"], modes: ["chat"] },
      widget_public_key: "pk_existing123",
    });
    renderClient();
    const snippet = await screen.findByText(/data-key="pk_existing123"/);
    expect(snippet.textContent).toContain("widget.js");
  });

  it("QA-1 F-13: rotating the key asks first (the live snippet stops working), then swaps the snippet", async () => {
    seed({ widget_enabled: true, widget_settings: {}, widget_public_key: "pk_old" });
    // The refetch after the rotation reads the new key back.
    fake.queue("tenants:select", {
      data: { widget_enabled: true, widget_settings: {}, widget_public_key: "pk_newkey" },
      error: null,
    });
    const routes = stubRoutes({
      [ROTATE_ROUTE]: () => ({ body: { ok: true, widget_public_key: "pk_newkey" } }),
    });
    vi.stubGlobal("fetch", routes.fetchMock);
    const user = userEvent.setup();
    renderClient();
    await screen.findByText(/data-key="pk_old"/);

    await user.click(screen.getByRole("button", { name: /Rotate key/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/stops working right away/)).toBeInTheDocument();
    expect(routes.calls).toHaveLength(0);

    await user.click(within(dialog).getByRole("button", { name: "Rotate key" }));
    expect(await screen.findByText(/data-key="pk_newkey"/)).toBeInTheDocument();
    expect(routes.calls[0]?.method).toBe("POST");
  });

  it("QA-1 F-13: cancelling the rotate confirmation leaves the key alone", async () => {
    seed({ widget_enabled: true, widget_settings: {}, widget_public_key: "pk_old" });
    const routes = stubRoutes({});
    vi.stubGlobal("fetch", routes.fetchMock);
    const user = userEvent.setup();
    renderClient();
    await screen.findByText(/data-key="pk_old"/);
    await user.click(screen.getByRole("button", { name: /Rotate key/ }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
    );
    expect(routes.calls).toHaveLength(0);
    expect(screen.getByText(/data-key="pk_old"/)).toBeInTheDocument();
  });

  it("rejects an invalid origin and accepts a valid https origin", async () => {
    seed({
      widget_enabled: true,
      widget_settings: { allowed_origins: [] },
      widget_public_key: "pk_1",
    });
    const user = userEvent.setup();
    renderClient();
    await screen.findByText(/No domains added yet/);

    const input = screen.getByPlaceholderText("https://example.com");
    await user.type(input, "not-a-url");
    await user.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(screen.getByText(/No domains added yet/)).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "https://acme.example");
    await user.click(screen.getByRole("button", { name: /^Add$/ }));

    expect(await screen.findByText("https://acme.example")).toBeInTheDocument();
  });

  it("QA-1 F-13: refuses wildcards and stores a case-different origin lower-cased, not as a duplicate", async () => {
    seed({
      widget_enabled: true,
      widget_settings: { allowed_origins: ["https://acme.example"] },
      widget_public_key: "pk_1",
    });
    const user = userEvent.setup();
    renderClient();
    await screen.findByText("https://acme.example");
    const input = screen.getByPlaceholderText("https://example.com");

    await user.type(input, "https://*.acme.example");
    await user.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(toast.error).toHaveBeenLastCalledWith(expect.stringMatching(/Wildcards/));

    await user.clear(input);
    await user.type(input, "https://ACME.example/");
    await user.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(toast.error).toHaveBeenLastCalledWith("That domain is already allowed.");
    expect(screen.getAllByText("https://acme.example")).toHaveLength(1);
  });

  it("removes a domain from the allowlist", async () => {
    seed({
      widget_enabled: true,
      widget_settings: { allowed_origins: ["https://acme.example"] },
      widget_public_key: "pk_1",
    });
    const user = userEvent.setup();
    renderClient();
    await screen.findByText("https://acme.example");
    // The remove button's own accessible name already carries the origin
    // (`aria-label={`Remove ${origin}`}` in website-widget-client.tsx) — no
    // need to walk the DOM up to the row to scope the query.
    await user.click(screen.getByRole("button", { name: "Remove https://acme.example" }));
    expect(screen.queryByText("https://acme.example")).not.toBeInTheDocument();
  });

  it("saves immediately, through the route, when the widget-enabled switch is toggled", async () => {
    seed({ widget_enabled: false, widget_settings: {}, widget_public_key: "pk_1" });
    const routes = stubRoutes({ [SETTINGS_ROUTE]: () => ({ body: { ok: true } }) });
    vi.stubGlobal("fetch", routes.fetchMock);
    const user = userEvent.setup();
    renderClient();
    await screen.findByText(/data-key="pk_1"/);

    await user.click(screen.getByRole("switch", { name: /Widget enabled/ }));

    await waitFor(() => expect(routes.calls).toHaveLength(1));
    expect(routes.calls[0]?.body).toEqual({ widget_enabled: true });
  });

  it("QA-1 F-13: a non-hex accent is rejected inline and nothing is sent", async () => {
    seed({ widget_enabled: true, widget_settings: {}, widget_public_key: "pk_1" });
    const routes = stubRoutes({ [SETTINGS_ROUTE]: () => ({ body: { ok: true } }) });
    vi.stubGlobal("fetch", routes.fetchMock);
    const user = userEvent.setup();
    renderClient();
    const hex = await screen.findByLabelText("Accent color (hex)");
    await user.clear(hex);
    await user.type(hex, "orange");
    await user.click(screen.getByRole("button", { name: "Save appearance" }));
    expect(await screen.findByText(/6-digit hex colour/)).toBeInTheDocument();
    expect(routes.calls).toHaveLength(0);
  });

  it("QA-1 F-13: unticking every mode can't be saved", async () => {
    seed({
      widget_enabled: true,
      widget_settings: { modes: ["chat"] },
      widget_public_key: "pk_1",
    });
    const routes = stubRoutes({ [SETTINGS_ROUTE]: () => ({ body: { ok: true } }) });
    vi.stubGlobal("fetch", routes.fetchMock);
    const user = userEvent.setup();
    renderClient();
    await user.click(await screen.findByRole("checkbox", { name: "Chat" }));
    await user.click(screen.getByRole("button", { name: "Save appearance" }));
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/at least one/));
    expect(routes.calls).toHaveLength(0);
  });

  it("saves normalized settings through the route", async () => {
    seed({
      widget_enabled: true,
      widget_settings: { accent: "#123456", modes: ["chat"] },
      widget_public_key: "pk_1",
    });
    const routes = stubRoutes({ [SETTINGS_ROUTE]: () => ({ body: { ok: true } }) });
    vi.stubGlobal("fetch", routes.fetchMock);
    const user = userEvent.setup();
    renderClient();
    const hex = await screen.findByLabelText("Accent color (hex)");
    await user.clear(hex);
    await user.type(hex, "#ABCDEF");
    await user.click(screen.getByRole("button", { name: "Save appearance" }));
    await waitFor(() => expect(routes.calls).toHaveLength(1));
    expect(routes.calls[0]?.body).toMatchObject({
      widget_settings: { accent: "#abcdef", modes: ["chat"] },
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved"));
  });

  it("QA-1 F-13: the hex input has an accessible name (axe 'label')", async () => {
    seed({ widget_enabled: true, widget_settings: {}, widget_public_key: "pk_1" });
    renderClient();
    expect(await screen.findByLabelText("Accent color (hex)")).toBeInTheDocument();
    expect(screen.getByLabelText("Accent color picker")).toBeInTheDocument();
  });

  it("shows combined AI reply usage for the last 30 days", async () => {
    seed({ widget_enabled: true, widget_settings: {}, widget_public_key: "pk_1" });
    renderClient();
    expect(await screen.findByText("10")).toBeInTheDocument();
  });

  it("QA-1 F-12: on a phone-sized screen the fixed preview launcher is not mounted (it covered the bottom-nav 'More')", async () => {
    mockMatchMedia(true);
    seed({ widget_enabled: true, widget_settings: {}, widget_public_key: "pk_1" });
    renderClient();
    expect(await screen.findByText(/live preview needs a wider screen/)).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 600));
    // eslint-disable-next-line testing-library/no-node-access
    expect(document.querySelector("script[data-heyloo-widget-preview]")).toBeNull();
  });

  it("QA-1 F-12: on a desktop screen the preview widget is still mounted", async () => {
    mockMatchMedia(false);
    seed({ widget_enabled: true, widget_settings: {}, widget_public_key: "pk_1" });
    renderClient();
    await screen.findByText(/Look for the button/);
    await waitFor(() =>
      // eslint-disable-next-line testing-library/no-node-access
      expect(document.querySelector("script[data-heyloo-widget-preview]")).not.toBeNull(),
    );
  });

  it("QA-1 F-5: a member gets a read-only page (disabled switch and inputs, no Save/Rotate buttons)", async () => {
    seed({
      widget_enabled: true,
      widget_settings: { allowed_origins: ["https://acme.example"] },
      widget_public_key: "pk_1",
    });
    renderClient({ canWrite: false });
    expect(await screen.findByTestId("read-only-note")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /Widget enabled/ })).toBeDisabled();
    expect(screen.getByLabelText("Accent color (hex)")).toBeDisabled();
    expect(screen.getByLabelText("Allowed domain")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save appearance" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save domains" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Rotate key/ })).not.toBeInTheDocument();
  });
});
