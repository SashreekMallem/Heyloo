import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "update", "maybeSingle"]) {
    obj[method] = vi.fn(() => obj);
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

let tenantRow: {
  widget_enabled: boolean;
  widget_settings: Record<string, unknown>;
  widget_public_key: string | null;
};
const updateSpy = vi.fn();

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: {
    from: vi.fn((table: string) => {
      if (table === "tenants") {
        const c = chain({ data: tenantRow, error: null });
        (c as { update: unknown }).update = (patch: unknown) => {
          updateSpy(patch);
          Object.assign(tenantRow, patch);
          return c;
        };
        return c;
      }
      if (table === "usage_daily") {
        return chain({ data: [{ text_messages_out: 4 }, { text_messages_out: 6 }], error: null });
      }
      return chain({ data: null, error: null });
    }),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { WebsiteWidgetClient } from "./website-widget-client";

function renderClient() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <WebsiteWidgetClient tenantId="t1" />
    </QueryClientProvider>,
  );
}

describe("WebsiteWidgetClient", () => {
  afterEach(() => {
    updateSpy.mockClear();
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
    tenantRow = { widget_enabled: false, widget_settings: {}, widget_public_key: null };
    renderClient();
    expect(await screen.findByText(/Generate a public key/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Copy snippet")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate key/ })).toBeInTheDocument();
  });

  it("shows the embed snippet with the existing public key", async () => {
    tenantRow = {
      widget_enabled: true,
      widget_settings: { allowed_origins: ["https://acme.example"], modes: ["chat"] },
      widget_public_key: "pk_existing123",
    };
    renderClient();
    const snippet = await screen.findByText(/data-key="pk_existing123"/);
    expect(snippet.textContent).toContain("widget.js");
  });

  it("rotates the key and updates the displayed snippet", async () => {
    tenantRow = { widget_enabled: true, widget_settings: {}, widget_public_key: "pk_old" };
    const user = userEvent.setup();
    renderClient();
    await screen.findByText(/data-key="pk_old"/);

    await user.click(screen.getByRole("button", { name: /Rotate key/ }));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ widget_public_key: expect.stringMatching(/^pk_/) }),
      );
    });
    const call = updateSpy.mock.calls[0]?.[0] as { widget_public_key: string } | undefined;
    const newKey = call?.widget_public_key ?? "";
    expect(newKey).not.toBe("pk_old");
    expect(await screen.findByText(new RegExp(`data-key="${newKey}"`))).toBeInTheDocument();
  });

  it("rejects an invalid origin and accepts a valid https origin", async () => {
    tenantRow = {
      widget_enabled: true,
      widget_settings: { allowed_origins: [] },
      widget_public_key: "pk_1",
    };
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

  it("removes a domain from the allowlist", async () => {
    tenantRow = {
      widget_enabled: true,
      widget_settings: { allowed_origins: ["https://acme.example"] },
      widget_public_key: "pk_1",
    };
    const user = userEvent.setup();
    renderClient();
    await screen.findByText("https://acme.example");
    // The remove button's own accessible name already carries the origin
    // (`aria-label={`Remove ${origin}`}` in website-widget-client.tsx) — no
    // need to walk the DOM up to the row to scope the query.
    await user.click(screen.getByRole("button", { name: "Remove https://acme.example" }));
    expect(screen.queryByText("https://acme.example")).not.toBeInTheDocument();
  });

  it("saves immediately when the widget-enabled switch is toggled", async () => {
    tenantRow = { widget_enabled: false, widget_settings: {}, widget_public_key: "pk_1" };
    const user = userEvent.setup();
    renderClient();
    await screen.findByText(/data-key="pk_1"/);

    await user.click(screen.getByRole("switch", { name: /Widget enabled/ }));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ widget_enabled: true }));
    });
  });

  it("shows combined AI reply usage for the last 30 days", async () => {
    tenantRow = { widget_enabled: true, widget_settings: {}, widget_public_key: "pk_1" };
    renderClient();
    expect(await screen.findByText("10")).toBeInTheDocument();
  });
});
