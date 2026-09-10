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
import { AdminIconRail } from "./admin-icon-rail";
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
            <>
              {/* 768–1023px: collapsed icon rail — the full labeled nav
                  below is `lg:block`-gated, so it never renders (and never
                  fires its own `hidden md:block` landmark) below `lg`; see
                  `AdminIconRail`'s docstring for why this is a local
                  `apps/web` fallback rather than a `packages/ui` prop. */}
              <div className="hidden md:block lg:hidden">
                <AdminIconRail sections={SECTIONS} activeHref={pathname} />
              </div>
              {/* Wrapped in a real `<aside>` landmark — `<AppSidebarNav>`'s
                  underlying `Sidebar` primitive renders plain `<div>`s with
                  no landmark of its own, which left the whole nav column
                  outside any landmark region (axe `region`, admin-partner
                  design review round 5, moderate — reproduced on all 25
                  cockpit routes). */}
              <aside aria-label="Cockpit navigation" className="hidden lg:block">
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
              </aside>
            </>
          }
          topBar={
            <TopBar
              logo={
                // `text-foreground` for the label (not `text-success`) —
                // this exact tint pattern (a colored-text pill on a 10%
                // tint of the same color) failed AA at 4.31:1 on every
                // cockpit route (admin-partner design review round 5,
                // major); `text-foreground` + a colored icon is the same
                // safe convention `<Callout variant="success">` already
                // uses, so it stays AA regardless of how `--success`
                // itself gets re-tuned (docs/audit/DESIGN_REQUESTS.md has
                // the ask for a shared tint-pill component so call sites
                // stop hand-rolling this pairing).
                <span className="flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-2.5 py-1 text-micro font-medium text-foreground">
                  <ShieldCheck className="size-3.5 text-success" aria-hidden="true" />
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
