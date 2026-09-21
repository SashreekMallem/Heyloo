"use client";

import {
  cn,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@heyloo/ui";
import type { ReactNode } from "react";
import { AgentPublishStatus } from "@/components/tenant/agent-publish-status";
import { Link, usePathname, useRouter } from "@/i18n/navigation";

const TABS = [
  { value: "greeting", label: "Greeting & Persona" },
  { value: "hours", label: "Hours" },
  { value: "services", label: "Services" },
  { value: "faq", label: "FAQ" },
  { value: "instructions", label: "AI Instructions" },
  { value: "vertical-details", label: "Vertical details" },
  { value: "manual-mode", label: "Manual Mode" },
  { value: "language", label: "Language" },
  { value: "text-agent", label: "Text agent" },
];

export function AgentSettingsTabs({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const active = TABS.find((t) => pathname.endsWith(t.value))?.value ?? "greeting";

  return (
    <div className="space-y-6">
      <PageHeader title="Agent settings" actions={<AgentPublishStatus />} />

      {/* Desktop/tablet sub-nav — plain nav+links (not Tabs/TabsTrigger: there's
          no matching TabsContent panel per route, so reusing Tabs ARIA here
          produced an invalid aria-controls relationship). Scrolls horizontally
          so every label stays reachable even before all 8 fit unclipped
          (~1440px+); only shown once the mobile select below is hidden. */}
      <nav aria-label="Agent settings sections" className="hidden lg:block">
        <div className="-mx-1 flex gap-1 overflow-x-auto rounded-md bg-muted p-1 text-muted-foreground">
          {TABS.map((tab) => {
            const isActive = tab.value === active;
            return (
              <Link
                key={tab.value}
                href={`/dashboard/agent/${tab.value}`}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-sm px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive ? "bg-background text-foreground shadow-sm" : "hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Mobile/tablet select switcher — stays active until the row above
          actually fits without clipping or overflow (FRONTEND_SPEC.md §6.6). */}
      <Select value={active} onValueChange={(v) => router.push(`/dashboard/agent/${v}`)}>
        <SelectTrigger className="w-full lg:hidden" aria-label="Agent settings section">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TABS.map((tab) => (
            <SelectItem key={tab.value} value={tab.value}>
              {tab.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {children}
    </div>
  );
}
