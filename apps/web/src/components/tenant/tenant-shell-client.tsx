"use client";

import {
  AppShell,
  AppSidebarNav,
  ManualModeBanner,
  MobileTabBar,
  MobileTabBarLabel,
  type NavItem,
  type NavSection,
  NotificationCenter,
  RealtimeIndicator,
  TopBar,
} from "@heyloo/ui";
import { Calendar, MessageSquare, MoreHorizontal, Phone, Settings, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { useTenantNotifications } from "@/lib/hooks/use-tenant-notifications";
import { useTenantRealtimeStatus } from "@/lib/realtime/tenant-realtime-provider";
import { TenantIdProvider } from "@/lib/tenant/tenant-context";

const NAV_ITEMS: NavItem[] = [
  { label: "Overview", href: "/dashboard" },
  { label: "Calls", href: "/dashboard/calls", icon: Phone },
  { label: "Bookings", href: "/dashboard/bookings", icon: Calendar },
  { label: "Customers", href: "/dashboard/customers", icon: Users },
  { label: "Agent", href: "/dashboard/agent" },
  { label: "Phone Setup", href: "/dashboard/phone-setup" },
  { label: "Delivery", href: "/dashboard/delivery" },
  { label: "Billing", href: "/dashboard/billing" },
  { label: "Refer & Earn", href: "/dashboard/refer" },
  { label: "Support", href: "/dashboard/support", icon: MessageSquare },
];

const MOBILE_TABS: NavItem[] = [
  { label: "Overview", href: "/dashboard" },
  { label: "Calls", href: "/dashboard/calls", icon: Phone },
  { label: "Bookings", href: "/dashboard/bookings", icon: Calendar },
  { label: "Customers", href: "/dashboard/customers", icon: Users },
  { label: "More", href: "/dashboard/support", icon: MoreHorizontal },
];

const SECTIONS: NavSection[] = [{ items: NAV_ITEMS }];

function TopBarContent({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const status = useTenantRealtimeStatus();
  const { data: notifications } = useTenantNotifications(tenantId);

  return (
    <>
      <span className="text-sm font-medium">{tenantName}</span>
      <RealtimeIndicator status={status} />
      <NotificationCenter
        items={notifications?.items ?? []}
        unreadCount={notifications?.unreadCount ?? 0}
        onOpen={() => {}}
      />
      <Link
        href="/dashboard/agent/greeting"
        className="flex size-8 items-center justify-center rounded-full bg-secondary"
      >
        <Settings className="size-4" />
      </Link>
    </>
  );
}

export function TenantShellClient({
  tenantId,
  tenantName,
  manualMode,
  manualModeSince,
  children,
}: {
  tenantId: string;
  tenantName: string;
  manualMode: boolean;
  manualModeSince: string | null;
  children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <TenantIdProvider tenantId={tenantId}>
      <AppShell
        sidebar={
          <AppSidebarNav
            sections={SECTIONS}
            activeHref={pathname}
            header={<span className="px-2 text-sm font-semibold">Heyloo</span>}
            renderLink={(item, isActive) => (
              <Link href={item.href} data-active={isActive}>
                {item.icon && <item.icon className="size-4" />}
                {item.label}
              </Link>
            )}
          />
        }
        topBar={
          <TopBar>
            <TopBarContent tenantId={tenantId} tenantName={tenantName} />
          </TopBar>
        }
        banner={manualMode && manualModeSince ? <ManualModeBanner since={manualModeSince} /> : null}
        mobileTabBar={
          <MobileTabBar
            items={MOBILE_TABS}
            activeHref={pathname}
            renderLink={(item, isActive) => (
              <Link href={item.href}>
                <MobileTabBarLabel item={item} isActive={isActive} />
              </Link>
            )}
          />
        }
      >
        {children}
      </AppShell>
    </TenantIdProvider>
  );
}
