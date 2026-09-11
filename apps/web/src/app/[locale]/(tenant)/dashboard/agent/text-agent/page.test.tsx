import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "maybeSingle"]) {
    obj[method] = vi.fn(() => obj);
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

let tenantRow: {
  text_agent_enabled: boolean;
  text_agent_persona: Record<string, unknown>;
  quiet_hours: Record<string, unknown>;
};
const updateSpy = vi.fn();

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: {
    from: vi.fn(() => {
      const c = chain({ data: tenantRow, error: null });
      (c as { update: unknown }).update = (patch: unknown) => {
        updateSpy(patch);
        Object.assign(tenantRow, patch);
        return c;
      };
      return c;
    }),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TenantIdProvider } from "@/lib/tenant/tenant-context";
import TextAgentTabPage from "./page";

function renderPage() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <TenantIdProvider tenantId="t1">
        <TextAgentTabPage />
      </TenantIdProvider>
    </QueryClientProvider>,
  );
}

describe("TextAgentTabPage", () => {
  afterEach(() => updateSpy.mockClear());

  it("loads existing settings into the form", async () => {
    tenantRow = {
      text_agent_enabled: true,
      text_agent_persona: { tone: "professional", signOff: "— Acme" },
      quiet_hours: { enabled: true, start: "22:00", end: "08:00" },
    };
    renderPage();
    expect(await screen.findByRole("switch", { name: /Text agent enabled/ })).toBeChecked();
    expect(await screen.findByLabelText("Sign-off (optional)")).toHaveValue("— Acme");
    expect(screen.getByLabelText("Starts at")).toHaveValue("22:00");
  });

  it("saves immediately when the master toggle is flipped", async () => {
    tenantRow = { text_agent_enabled: false, text_agent_persona: {}, quiet_hours: {} };
    const user = userEvent.setup();
    renderPage();
    const toggle = await screen.findByRole("switch", { name: /Text agent enabled/ });
    await user.click(toggle);
    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ text_agent_enabled: true }));
    });
  });

  it("saves persona (tone + sign-off) on demand", async () => {
    tenantRow = { text_agent_enabled: true, text_agent_persona: {}, quiet_hours: {} };
    const user = userEvent.setup();
    renderPage();
    const signOff = await screen.findByLabelText("Sign-off (optional)");
    await user.type(signOff, "Thanks!");
    await user.click(screen.getByRole("button", { name: "Save persona" }));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          text_agent_persona: expect.objectContaining({ signOff: "Thanks!" }),
        }),
      );
    });
  });

  it("saves quiet hours on demand", async () => {
    tenantRow = {
      text_agent_enabled: true,
      text_agent_persona: {},
      quiet_hours: { enabled: false },
    };
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("switch", { name: "Enable quiet hours" }));
    await user.click(screen.getByRole("button", { name: "Save quiet hours" }));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          quiet_hours: expect.objectContaining({ enabled: true }),
        }),
      );
    });
  });
});
