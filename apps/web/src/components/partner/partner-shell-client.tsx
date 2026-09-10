"use client";

import { AppShell, AppSidebarNav, type NavSection, TopBar } from "@heyloo/ui";
import type { ReactNode } from "react";
import { Link, usePathname } from "@/i18n/navigation";

const SECTIONS: NavSection[] = [
  {
    items: [
      { label: "Dashboard", href: "/portal" },
      { label: "Customers", href: "/portal/customers" },
      { label: "Payouts", href: "/portal/payouts" },
      { label: "W-9", href: "/portal/w9" },
      { label: "Settings", href: "/portal/settings" },
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
        <AppSidebarNav
          sections={SECTIONS}
          activeHref={pathname}
          header={<span className="px-2 text-sm font-semibold">Partner Portal</span>}
          renderLink={(item, isActive) => (
            <Link href={item.href} data-active={isActive}>
              {item.label}
            </Link>
          )}
        />
      }
      topBar={
        <TopBar>
          <span className="text-sm font-medium">{partnerName}</span>
        </TopBar>
      }
    >
      {children}
    </AppShell>
  );
}
