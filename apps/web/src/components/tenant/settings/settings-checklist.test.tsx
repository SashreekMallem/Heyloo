import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithTenant, stubRoutes } from "@/test/render-with-tenant";

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import { SettingsChecklist } from "./settings-checklist";

afterEach(() => vi.unstubAllGlobals());

describe("SettingsChecklist (SETTINGS-1)", () => {
  it("shows done/not-set items with links to where each is set", async () => {
    const routes = stubRoutes({
      "/api/tenant/settings/checklist": () => ({
        body: {
          requiredTotal: 2,
          requiredDone: 1,
          items: [
            {
              id: "transfer_number",
              label: "Transfer number",
              done: false,
              detail: "Not set — callers who ask for a person can't be put through.",
              href: "/dashboard/agent/instructions",
              optional: false,
            },
            {
              id: "business_hours",
              label: "Business hours",
              done: true,
              detail: "Open 5 days a week.",
              href: "/dashboard/agent/hours",
              optional: false,
            },
          ],
        },
      }),
    });
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<SettingsChecklist tenantId="t1" />);
    expect(await screen.findByText("1 of 2 done")).toBeInTheDocument();
    expect(screen.getByText("(not set)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Transfer number/ })).toHaveAttribute(
      "href",
      "/dashboard/agent/instructions",
    );
  });

  it("renders nothing when the route fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    const { container } = renderWithTenant(<SettingsChecklist tenantId="t1" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).not.toContain("Settings checklist");
  });
});
