import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

const routerPush = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: routerPush }),
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
