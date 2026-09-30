"use client";

import {
  AppShell,
  AppSidebarNav,
  ImpersonationBanner,
  ManualModeBanner,
  MobileTabBar,
  MobileTabBarLabel,
  NAV_ICONS,
  type NavItem,
  type NavSection,
  RealtimeIndicator,
  ThemeToggle,
  TopBar,
} from "@heyloo/ui";
import { NotificationCenter } from "@heyloo/ui/notification";
import { useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import {
  markNotificationsSeen,
  notificationsQueryKey,
  useTenantNotifications,
} from "@/lib/hooks/use-tenant-notifications";
import { useImpersonationBanner } from "@/lib/impersonation/use-impersonation-banner";
import { useTenantRealtimeStatus } from "@/lib/realtime/tenant-realtime-provider";
import { isReferralAttributionLive } from "@/lib/referrals/attribution";
import { TenantIdProvider } from "@/lib/tenant/tenant-context";

const OPERATE_SECTION: NavSection = {
  label: "Operate",
  items: [
    { label: "Overview", href: "/dashboard", icon: NAV_ICONS.overview },
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
    // Hidden until referral attribution works end to end (QA-1 F-24) — see
    // lib/referrals/attribution.ts.
    ...(isReferralAttributionLive()
      ? [{ label: "Refer & earn", href: "/dashboard/refer", icon: NAV_ICONS.refer }]
      : []),
    { label: "Support", href: "/dashboard/support", icon: NAV_ICONS.support },
  ],
};

const MOBILE_TABS: NavItem[] = [
  { label: "Overview", href: "/dashboard", icon: NAV_ICONS.overview },
  { label: "Calls", href: "/dashboard/calls", icon: NAV_ICONS.calls },
  { label: "Bookings", href: "/dashboard/bookings", icon: NAV_ICONS.bookings },
  { label: "Customers", href: "/dashboard/customers", icon: NAV_ICONS.customers },
  { label: "More", href: "/dashboard/support", icon: MoreHorizontal },
];

const SECTIONS: NavSection[] = [OPERATE_SECTION, CONFIGURE_SECTION, GROW_SECTION];

function TopBarContent({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const status = useTenantRealtimeStatus();
  const { data: notifications } = useTenantNotifications(tenantId);
  const router = useRouter();
  const queryClient = useQueryClient();
  const SettingsIcon = NAV_ICONS.settings;

  return (
    <>
      <span className="text-sm font-medium">{tenantName}</span>
      <RealtimeIndicator status={status} />
      <NotificationCenter
        items={notifications?.items ?? []}
        unreadCount={notifications?.unreadCount ?? 0}
        // Clicking an item opens the booking / call / thread it describes (QA-1 F-04).
        onOpen={(item) => {
          if (item.href) router.push(item.href);
        }}
        // Opening the bell marks everything read (writes the member's own
        // last_seen_notifications_at), so the badge clears and stays cleared.
        onOpenChange={(open) => {
          if (!open || !notifications?.unreadCount) return;
          void markNotificationsSeen(tenantId).then((ok) => {
            if (ok)
              void queryClient.invalidateQueries({ queryKey: notificationsQueryKey(tenantId) });
          });
        }}
      />
      <ThemeToggle />
      <Link
        href="/dashboard/agent"
        aria-label="Agent settings"
        className="flex size-8 items-center justify-center rounded-full bg-secondary transition-colors duration-(--duration-fast) ease-(--ease-out) hover:bg-secondary/70"
      >
        <SettingsIcon className="size-4" />
      </Link>
    </>
  );
}

export function TenantShellClient({
  tenantId,
  tenantName,
  manualMode,
  manualModeSince,
  canWrite = true,
  isOwner = canWrite,
  children,
}: {
  tenantId: string;
  tenantName: string;
  manualMode: boolean;
  manualModeSince: string | null;
  /** Owner/admin (JWT `role` claim) — false renders settings pages read-only (QA-1). */
  canWrite?: boolean;
  /** Exactly the owner role (team invites) — false for admins and members (QA-1 AUTH-15). */
  isOwner?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const impersonation = useImpersonationBanner(tenantId);

  return (
    <TenantIdProvider tenantId={tenantId} canWrite={canWrite} isOwner={isOwner}>
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
