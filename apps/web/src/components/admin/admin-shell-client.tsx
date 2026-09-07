"use client";

import {
  AppShell,
  AppSidebarNav,
  CommandPalette,
  type CommandPaletteCommand,
  type NavSection,
} from "@heyloo/ui";
import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Link, usePathname, useRouter } from "@/i18n/navigation";

const SECTIONS: NavSection[] = [
  {
    label: "Margin Cockpit",
    items: [
      { label: "Waterfall", href: "/cockpit/margin/waterfall" },
      { label: "Per-customer", href: "/cockpit/margin/customers" },
      { label: "Per-call", href: "/cockpit/margin/calls" },
      { label: "Repricing drift", href: "/cockpit/margin/drift" },
      { label: "Config Lab", href: "/cockpit/config-lab" },
      { label: "Referral P&L", href: "/cockpit/margin/referrals" },
      { label: "CAC", href: "/cockpit/margin/cac" },
      { label: "Bottlenecks", href: "/cockpit/margin/bottlenecks" },
      { label: "Alerts", href: "/cockpit/alerts" },
    ],
  },
  {
    items: [
      { label: "Tenants", href: "/cockpit/tenants" },
      { label: "Outreach", href: "/cockpit/outreach" },
      { label: "Templates", href: "/cockpit/templates" },
      { label: "Settings", href: "/cockpit/settings" },
    ],
  },
];

export function AdminShellClient({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const commands: CommandPaletteCommand[] = SECTIONS.flatMap((section) =>
    section.items.map((item) => ({
      label: `Go to ${item.label}`,
      group: section.label ?? "Navigate",
      run: () => router.push(item.href),
    })),
  );

  return (
    <>
      <div className="hidden md:block">
        <AppShell
          sidebar={
            <AppSidebarNav
              sections={SECTIONS}
              activeHref={pathname}
              header={<span className="px-2 text-sm font-semibold">Heyloo Cockpit</span>}
              renderLink={(item, isActive) => (
                <Link href={item.href} data-active={isActive}>
                  {item.label}
                </Link>
              )}
            />
          }
          topBar={
            <div className="flex h-14 items-center gap-3 border-b border-border px-4">
              <ShieldCheck className="size-4 text-success" />
              <span className="text-xs text-muted-foreground">AAL2 verified</span>
              <div className="ml-auto">
                <CommandPalette commands={commands} />
              </div>
            </div>
          }
        >
          {children}
        </AppShell>
      </div>
      <div className="flex min-h-svh flex-col items-center justify-center p-6 text-center md:hidden">
        <h1 className="text-lg font-semibold">Best viewed on desktop</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The margin cockpit is desktop-primary. Reduced summary coming soon on mobile.
        </p>
      </div>
    </>
  );
}
