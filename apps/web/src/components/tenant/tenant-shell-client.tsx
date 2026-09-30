"use client";

import {
  AppShell,
  AppSidebarNav,
  ImpersonationBanner,
  ManualModeBanner,
  MobileTabBar,
  MobileTabBarLabel,
  MobileTabBarMenuButton,
  NAV_ICONS,
  type NavItem,
  type NavSection,
  RealtimeIndicator,
  ThemeToggle,
  TopBar,
} from "@heyloo/ui";
import { NotificationCenter } from "@heyloo/ui/notification";
import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { SidebarAccount, UserMenu } from "@/components/shell/user-menu";
import { Link, usePathname } from "@/i18n/navigation";
import { useTenantNotifications } from "@/lib/hooks/use-tenant-notifications";
import { useImpersonationBanner } from "@/lib/impersonation/use-impersonation-banner";
import { useTenantRealtimeStatus } from "@/lib/realtime/tenant-realtime-provider";
import { TenantIdProvider } from "@/lib/tenant/tenant-context";

const OPERATE_SECTION: NavSection = {
  label: "Operate",
  items: [
    // `exact`: "/dashboard" prefixes every other route, so without it Overview
    // stayed highlighted on every page (QA-1 F-01).
    { label: "Overview", href: "/dashboard", icon: NAV_ICONS.overview, exact: true },
    { label: "Calls", href: "/dashboard/calls", icon: NAV_ICONS.calls },
    { label: "Bookings", href: "/dashboard/bookings", icon: NAV_ICONS.bookings },
    { label: "Customers", href: "/dashboard/customers", icon: NAV_ICONS.customers },
    { label: "Messages", href: "/dashboard/messages", icon: NAV_ICONS.messages },
    { label: "Orders", href: "/dashboard/orders", icon: NAV_ICONS.orders },
  ],
};

const CONFIGURE_SECTION: NavSection = {
  label: "Configure",
  items: [
    { label: "Setup", href: "/dashboard/setup", icon: NAV_ICONS.settings },
    { label: "Agent", href: "/dashboard/agent", icon: NAV_ICONS.agent },
    // SETTINGS-1: the Test agent page existed but had no sidebar entry.
    { label: "Test agent", href: "/dashboard/test-agent", icon: NAV_ICONS.calls },
    { label: "Phone setup", href: "/dashboard/phone-setup", icon: NAV_ICONS.phoneSetup },
    { label: "Website widget", href: "/dashboard/website-widget", icon: NAV_ICONS.websiteWidget },
    { label: "Delivery", href: "/dashboard/delivery", icon: NAV_ICONS.delivery },
    { label: "Text messaging", href: "/dashboard/texting", icon: NAV_ICONS.messages },
    { label: "Integrations", href: "/dashboard/integrations", icon: NAV_ICONS.integrations },
    { label: "Team", href: "/dashboard/team", icon: NAV_ICONS.team },
  ],
};

const GROW_SECTION: NavSection = {
  label: "Account",
  items: [
    { label: "Billing", href: "/dashboard/billing", icon: NAV_ICONS.billing },
    { label: "Refer & earn", href: "/dashboard/refer", icon: NAV_ICONS.refer },
    { label: "Support", href: "/dashboard/support", icon: NAV_ICONS.support },
  ],
};

/** The "More" tab is not a destination — it opens the navigation drawer (QA-1 F-13). Its href is only a stable key; it never matches a real path. */
const MORE_TAB_HREF = "#more";

const MOBILE_TABS: NavItem[] = [
  { label: "Overview", href: "/dashboard", icon: NAV_ICONS.overview, exact: true },
  { label: "Calls", href: "/dashboard/calls", icon: NAV_ICONS.calls },
  { label: "Bookings", href: "/dashboard/bookings", icon: NAV_ICONS.bookings },
  { label: "Customers", href: "/dashboard/customers", icon: NAV_ICONS.customers },
  { label: "More", href: MORE_TAB_HREF, icon: MoreHorizontal, exact: true },
];

const SECTIONS: NavSection[] = [OPERATE_SECTION, CONFIGURE_SECTION, GROW_SECTION];

function TopBarContent({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const status = useTenantRealtimeStatus();
  const { data: notifications } = useTenantNotifications(tenantId);
  const SettingsIcon = NAV_ICONS.settings;

  return (
    <>
      <span className="text-sm font-medium">{tenantName}</span>
      <RealtimeIndicator status={status} />
      <NotificationCenter
        items={notifications?.items ?? []}
        unreadCount={notifications?.unreadCount ?? 0}
        onOpen={() => {}}
      />
      <ThemeToggle />
      <Link
        href="/dashboard/agent"
        aria-label="Agent settings"
        className="flex size-11 items-center justify-center rounded-full bg-secondary transition-colors duration-(--duration-fast) ease-(--ease-out) hover:bg-secondary/70 lg:size-8"
      >
        <SettingsIcon className="size-4" />
      </Link>
      <UserMenu />
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
  const impersonation = useImpersonationBanner(tenantId);

  return (
    <TenantIdProvider tenantId={tenantId}>
      <AppShell
        sidebar={
          <AppSidebarNav
            sections={SECTIONS}
            activeHref={pathname}
            header={<span className="px-2 text-sm font-semibold">Heyloo</span>}
            footer={<SidebarAccount />}
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
        banner={
          impersonation || (manualMode && manualModeSince) ? (
            <>
              {impersonation && (
                <ImpersonationBanner
                  tenantName={tenantName}
                  adminEmail={impersonation.adminEmail}
                  expiresAt={impersonation.expiresAt}
                  editMode={impersonation.editMode}
                  onEnd={impersonation.onEnd}
                  onToggleEdit={impersonation.onToggleEdit}
                />
              )}
              {manualMode && manualModeSince && <ManualModeBanner since={manualModeSince} />}
            </>
          ) : null
        }
        mobileTabBar={
          <MobileTabBar
            items={MOBILE_TABS}
            activeHref={pathname}
            renderLink={(item, isActive) =>
              item.href === MORE_TAB_HREF ? (
                <MobileTabBarMenuButton item={item} />
              ) : (
                <Link href={item.href}>
                  <MobileTabBarLabel item={item} isActive={isActive} />
                </Link>
              )
            }
          />
        }
      >
        {children}
      </AppShell>
    </TenantIdProvider>
  );
}
