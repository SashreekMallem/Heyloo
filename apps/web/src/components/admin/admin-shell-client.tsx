"use client";

import {
  AppShell,
  AppSidebarNav,
  CommandPalette,
  type CommandPaletteCommand,
  TopBar,
} from "@heyloo/ui";
import { Gauge, Radar, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { currentSectionLabel, SECTIONS } from "./admin-nav-sections";

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
            <TopBar
              logo={
                <span className="flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-2.5 py-1 text-micro font-medium text-success">
                  <ShieldCheck className="size-3.5" aria-hidden="true" />
                  AAL2 verified
                </span>
              }
            >
              <CommandPalette commands={commands} />
            </TopBar>
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
