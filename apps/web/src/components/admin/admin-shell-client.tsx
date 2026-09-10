"use client";

import {
  AppShell,
  AppSidebarNav,
  CommandPalette,
  type CommandPaletteCommand,
  type NavSection,
} from "@heyloo/ui";
import {
  AlertTriangle,
  Bell,
  FlaskConical,
  Gauge,
  Handshake,
  Headset,
  LayoutTemplate,
  Megaphone,
  Radar,
  Settings,
  ShieldCheck,
  Sparkles,
  Store,
  Target,
  TrendingUp,
  Users,
  Waves,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, usePathname, useRouter } from "@/i18n/navigation";

const SECTIONS: NavSection[] = [
  {
    label: "Margin Cockpit",
    items: [
      { label: "Waterfall", href: "/cockpit/margin/waterfall", icon: Waves },
      { label: "Per-customer", href: "/cockpit/margin/customers", icon: Users },
      { label: "Per-call", href: "/cockpit/margin/calls", icon: Gauge },
      { label: "Repricing drift", href: "/cockpit/margin/drift", icon: TrendingUp },
      { label: "Config Lab", href: "/cockpit/config-lab", icon: FlaskConical },
      { label: "Referral P&L", href: "/cockpit/margin/referrals", icon: Sparkles },
      { label: "CAC", href: "/cockpit/margin/cac", icon: Target },
      { label: "Bottlenecks", href: "/cockpit/margin/bottlenecks", icon: AlertTriangle },
      { label: "Alerts", href: "/cockpit/alerts", icon: Bell },
    ],
  },
  {
    items: [
      { label: "Tenants", href: "/cockpit/tenants", icon: Store },
      { label: "Partners", href: "/cockpit/partners", icon: Handshake },
      { label: "Support", href: "/cockpit/support", icon: Headset },
      { label: "Outreach", href: "/cockpit/outreach", icon: Megaphone },
      { label: "Templates", href: "/cockpit/templates", icon: LayoutTemplate },
      { label: "Settings", href: "/cockpit/settings", icon: Settings },
    ],
  },
];

/** Best-effort human label for the mobile desktop-gate — falls back to a section-agnostic sentence when the current route isn't a recognized nav item (e.g. a detail route like `/cockpit/partners/[id]`). */
function currentSectionLabel(pathname: string): string | null {
  const allItems = SECTIONS.flatMap((section) => section.items);
  const match = allItems
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.label ?? null;
}

export function AdminShellClient({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const sectionLabel = currentSectionLabel(pathname);

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
              header={
                <span className="flex items-center gap-2 px-2 font-display text-small font-semibold tracking-tight">
                  <Radar className="size-4 text-accent" aria-hidden="true" />
                  Heyloo Cockpit
                </span>
              }
              renderLink={(item, isActive) => (
                <Link href={item.href} data-active={isActive}>
                  {item.icon && <item.icon className="size-4" aria-hidden="true" />}
                  {item.label}
                </Link>
              )}
            />
          }
          topBar={
            <div className="flex h-14 items-center gap-3 border-b border-border px-4">
              <span className="flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-2.5 py-1 text-micro font-medium text-success">
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                AAL2 verified
              </span>
              <div className="ml-auto">
                <CommandPalette commands={commands} />
              </div>
            </div>
          }
        >
          {children}
        </AppShell>
      </div>
      <div className="flex min-h-svh flex-col items-center justify-center gap-2 p-6 text-center md:hidden">
        <Gauge className="size-8 text-muted-foreground" aria-hidden="true" />
        <h1 className="font-display text-h4 font-semibold">Best viewed on desktop</h1>
        <p className="max-w-xs text-small text-muted-foreground">
          {sectionLabel
            ? `The ${sectionLabel} cockpit is desktop-primary.`
            : "This cockpit view is desktop-primary."}{" "}
          A reduced summary view is coming soon on mobile.
        </p>
      </div>
    </>
  );
}
