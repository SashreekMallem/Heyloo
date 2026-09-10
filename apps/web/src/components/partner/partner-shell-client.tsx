"use client";

import { AppShell, AppSidebarNav, type NavSection, TopBar } from "@heyloo/ui";
import { FileCheck2, Gauge, Handshake, Settings, Users, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { Link, usePathname } from "@/i18n/navigation";

const SECTIONS: NavSection[] = [
  {
    items: [
      { label: "Dashboard", href: "/portal", icon: Gauge },
      { label: "Customers", href: "/portal/customers", icon: Users },
      { label: "Payouts", href: "/portal/payouts", icon: Wallet },
      { label: "W-9", href: "/portal/w9", icon: FileCheck2 },
      { label: "Settings", href: "/portal/settings", icon: Settings },
    ],
  },
];

export function PartnerShellClient({
  partnerName,
  children,
}: {
  partnerName: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <AppShell
      sidebar={
        // Real `<aside>` landmark — `<AppSidebarNav>`'s underlying
        // `Sidebar` primitive renders plain `<div>`s with no landmark of
        // its own, the same gap the admin cockpit shell had (admin-partner
        // design review round 5, moderate; see `AdminShellClient`).
        <aside aria-label="Partner portal navigation">
          <AppSidebarNav
            sections={SECTIONS}
            activeHref={pathname}
            header={
              <span className="flex items-center gap-2 px-2 font-display text-small font-semibold tracking-tight">
                <Handshake className="size-4 text-accent" aria-hidden="true" />
                Partner Portal
              </span>
            }
            renderLink={(item, isActive) => (
              <Link href={item.href} data-active={isActive}>
                {item.icon && <item.icon className="size-4" aria-hidden="true" />}
                {item.label}
              </Link>
            )}
          />
        </aside>
      }
      topBar={
        <TopBar>
          <span className="text-small font-medium">{partnerName}</span>
        </TopBar>
      }
    >
      {children}
    </AppShell>
  );
}
