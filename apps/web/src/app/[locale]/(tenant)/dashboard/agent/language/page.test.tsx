import { screen, waitFor } from "@testing-library/react";
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
import LanguageTabPage from "./page";

beforeEach(() => fake.reset());
afterEach(() => vi.unstubAllGlobals());

describe("LanguageTabPage (SETTINGS-1)", () => {
  it("shows a saved Spanish tenant as Spanish (it used to be disabled 'coming soon')", async () => {
    fake.queue("tenants:select", { data: { language_config: { primary: "es" } }, error: null });
    vi.stubGlobal("fetch", stubRoutes({}).fetchMock);
    renderWithTenant(<LanguageTabPage />);
    expect(await screen.findByRole("combobox", { name: "AI call language" })).toHaveTextContent(
      "Español (Spanish)",
    );
  });

  it("saves through the route and tells the owner to publish", async () => {
    fake.queue("tenants:select", { data: { language_config: { primary: "es" } }, error: null });
    const routes = stubRoutes({
      "/api/tenant/settings/language": () => ({ body: { ok: true, changed: true } }),
    });
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<LanguageTabPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/Publish changes/)),
    );
    expect(routes.calls[0]?.body).toEqual({ primary: "es" });
  });
});
