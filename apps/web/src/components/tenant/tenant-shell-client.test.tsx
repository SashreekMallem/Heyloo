import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  usePathname: () => "/dashboard",
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
