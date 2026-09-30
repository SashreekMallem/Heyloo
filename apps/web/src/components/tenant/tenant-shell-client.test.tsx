import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const pathname = vi.hoisted(() => ({ current: "/dashboard" }));

const routerPush = vi.fn();
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
  useRouter: () => ({ push: routerPush, refresh: vi.fn() }),
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

let notificationsData: unknown = { items: [], unreadCount: 0 };
const markNotificationsSeen = vi.fn(async (..._args: unknown[]) => true);
vi.mock("@/lib/hooks/use-tenant-notifications", () => ({
  useTenantNotifications: () => ({ data: notificationsData }),
  markNotificationsSeen: (...args: unknown[]) => markNotificationsSeen(...args),
  notificationsQueryKey: (tenantId: string) => ["tenant", tenantId, "bookings", "notifications"],
}));

vi.mock("@/lib/realtime/tenant-realtime-provider", () => ({
  useTenantRealtimeStatus: () => "connected",
}));

const useImpersonationBanner = vi.fn();
vi.mock("@/lib/impersonation/use-impersonation-banner", () => ({
  useImpersonationBanner: (tenantId: string) => useImpersonationBanner(tenantId),
}));

import { useCanWriteSettings, useIsTenantOwner } from "@/lib/tenant/tenant-context";
import { TenantShellClient } from "./tenant-shell-client";

function renderShell() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TenantShellClient tenantId="t1" tenantName="Acme" manualMode={false} manualModeSince={null}>
        <p>dashboard content</p>
      </TenantShellClient>
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  // jsdom has no ResizeObserver; Radix's ScrollArea (the bell's popover) needs one.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

describe("TenantShellClient — nav (QA-1 F-24)", () => {
  it("hides 'Refer & earn' while referral attribution is not live, keeping Billing and Support", () => {
    useImpersonationBanner.mockReturnValue(null);
    renderShell();
    expect(screen.queryByText("Refer & earn")).not.toBeInTheDocument();
    expect(screen.getAllByText("Billing").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Support").length).toBeGreaterThan(0);
  });
});

describe("TenantShellClient — notification bell (QA-1 F-04)", () => {
  it("marks notifications read when the bell opens and opens the item's target when clicked", async () => {
    notificationsData = {
      unreadCount: 1,
      items: [
        {
          id: "booking:b1",
          title: "Jamie Cruz — booking booked",
          description: "Thu, Oct 1, 10:00 AM",
          createdAt: "2026-09-29T10:00:00Z",
          read: false,
          href: "/dashboard/bookings?booking=b1",
        },
      ],
    };
    useImpersonationBanner.mockReturnValue(null);
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: /notifications/i }));
    await waitFor(() => expect(markNotificationsSeen).toHaveBeenCalledWith("t1"));

    await user.click(await screen.findByText("Jamie Cruz — booking booked"));
    expect(routerPush).toHaveBeenCalledWith("/dashboard/bookings?booking=b1");
    // popover closed after the click
    await waitFor(() =>
      expect(screen.queryByText("Jamie Cruz — booking booked")).not.toBeInTheDocument(),
    );
    notificationsData = { items: [], unreadCount: 0 };
  });

  it("does not write when there is nothing unread", async () => {
    markNotificationsSeen.mockClear();
    notificationsData = { items: [], unreadCount: 0 };
    useImpersonationBanner.mockReturnValue(null);
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole("button", { name: /notifications/i }));
    expect(markNotificationsSeen).not.toHaveBeenCalled();
  });
});

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

function RoleProbe() {
  return (
    <p>
      write:{String(useCanWriteSettings())} owner:{String(useIsTenantOwner())}
    </p>
  );
}

describe("TenantShellClient — role for settings pages (QA-1 F-5 / AUTH-15)", () => {
  function renderWith(props: { canWrite?: boolean; isOwner?: boolean }) {
    useImpersonationBanner.mockReturnValue(null);
    return render(
      <TenantShellClient
        tenantId="t1"
        tenantName="Acme"
        manualMode={false}
        manualModeSince={null}
        {...props}
      >
        <RoleProbe />
      </TenantShellClient>,
    );
  }

  it("defaults to full access when the layout passes nothing (previews, older callers)", () => {
    renderWith({});
    expect(screen.getByText("write:true owner:true")).toBeInTheDocument();
  });

  it("a member gets neither write nor owner", () => {
    renderWith({ canWrite: false, isOwner: false });
    expect(screen.getByText("write:false owner:false")).toBeInTheDocument();
  });

  it("an admin can write settings but is not the owner (invites are owner-only)", () => {
    renderWith({ canWrite: true, isOwner: false });
    expect(screen.getByText("write:true owner:false")).toBeInTheDocument();
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
