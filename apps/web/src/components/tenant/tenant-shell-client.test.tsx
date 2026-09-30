import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const pathname = vi.hoisted(() => ({ current: "/dashboard" }));

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    children,
    href,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => pathname.current,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// The account menu reads the browser session; the shell tests don't care who.
vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: {
    auth: {
      getSession: async () => ({ data: { session: { user: { email: "owner@acme.test" } } } }),
      getClaims: async () => ({
        data: { claims: { app_metadata: { role: "owner", tenant_id: "t1" } } },
        error: null,
      }),
      signOut: async () => ({ error: null }),
    },
  },
}));

vi.mock("@/lib/hooks/use-tenant-notifications", () => ({
  useTenantNotifications: () => ({ data: { items: [], unreadCount: 0 } }),
}));

vi.mock("@/lib/realtime/tenant-realtime-provider", () => ({
  useTenantRealtimeStatus: () => "connected",
}));

const useImpersonationBanner = vi.fn();
vi.mock("@/lib/impersonation/use-impersonation-banner", () => ({
  useImpersonationBanner: (tenantId: string) => useImpersonationBanner(tenantId),
}));

import { TenantShellClient } from "./tenant-shell-client";

function renderShell() {
  return render(
    <TenantShellClient tenantId="t1" tenantName="Acme" manualMode={false} manualModeSince={null}>
      <p>dashboard content</p>
    </TenantShellClient>,
  );
}

function stubPhoneViewport() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  );
}

afterEach(() => {
  pathname.current = "/dashboard";
  vi.unstubAllGlobals();
});

describe("TenantShellClient — impersonation banner mount", () => {
  it("renders no banner when there is no impersonation state", () => {
    useImpersonationBanner.mockReturnValue(null);
    renderShell();
    expect(screen.queryByText(/End impersonation/i)).not.toBeInTheDocument();
    expect(screen.getByText("dashboard content")).toBeInTheDocument();
  });

  it("mounts ImpersonationBanner with the hook's state when impersonation is active", () => {
    useImpersonationBanner.mockReturnValue({
      tenantId: "t1",
      tenantName: "Acme",
      adminEmail: "admin@heyloo.ai",
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      editMode: false,
      onEnd: vi.fn(),
      onToggleEdit: vi.fn(),
    });
    renderShell();
    expect(screen.getByText(/Viewing/)).toBeInTheDocument();
    expect(screen.getByText("Acme", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText(/read-only/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /End impersonation/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enable edits/i })).toBeInTheDocument();
  });

  it("hides the 'Enable edits' button once editMode is already true", () => {
    useImpersonationBanner.mockReturnValue({
      tenantId: "t1",
      tenantName: "Acme",
      adminEmail: "admin@heyloo.ai",
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      editMode: true,
      onEnd: vi.fn(),
      onToggleEdit: vi.fn(),
    });
    renderShell();
    expect(screen.getByText(/edits enabled/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enable edits/i })).not.toBeInTheDocument();
  });
});

describe("TenantShellClient — navigation (QA-1)", () => {
  it("highlights only the current section, never Overview alongside it (F-01)", () => {
    useImpersonationBanner.mockReturnValue(null);
    pathname.current = "/dashboard/calls";
    renderShell();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(
      within(nav)
        .getAllByRole("link", { current: "page" })
        .map((a) => a.textContent),
    ).toEqual(["Calls"]);
    const tabs = screen.getByRole("navigation", { name: "Primary" });
    expect(
      within(tabs)
        .getAllByRole("link", { current: "page" })
        .map((a) => a.textContent),
    ).toEqual(["Calls"]);
  });

  it("lights Overview on the dashboard root", () => {
    useImpersonationBanner.mockReturnValue(null);
    renderShell();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(
      within(nav)
        .getAllByRole("link", { current: "page" })
        .map((a) => a.textContent),
    ).toEqual(["Overview"]);
  });

  it("'More' opens the navigation drawer rather than linking to Support (F-13)", async () => {
    useImpersonationBanner.mockReturnValue(null);
    stubPhoneViewport();
    const user = userEvent.setup();
    renderShell();
    const tabs = screen.getByRole("navigation", { name: "Primary" });
    expect(within(tabs).queryByRole("link", { name: "More" })).not.toBeInTheDocument();
    await user.click(within(tabs).getByRole("button", { name: "More" }));
    const drawer = screen.getByRole("dialog", { name: "Navigation" });
    for (const name of ["Messages", "Orders", "Setup", "Billing", "Team", "Support"]) {
      expect(within(drawer).getByRole("link", { name })).toBeInTheDocument();
    }
  });

  it("puts the account email and Log out in the drawer footer (AUTH-02)", async () => {
    useImpersonationBanner.mockReturnValue(null);
    stubPhoneViewport();
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole("button", { name: "Toggle sidebar" }));
    const drawer = screen.getByRole("dialog", { name: "Navigation" });
    expect(await within(drawer).findByText("owner@acme.test")).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("has an account menu in the top bar (AUTH-02)", () => {
    useImpersonationBanner.mockReturnValue(null);
    renderShell();
    expect(screen.getByRole("button", { name: "Account menu" })).toBeInTheDocument();
  });
});
