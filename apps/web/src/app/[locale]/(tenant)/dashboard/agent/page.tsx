"use client";

import { Card, CardContent } from "@heyloo/ui";
import { ChevronRight } from "lucide-react";
import { SettingsChecklist } from "@/components/tenant/settings/settings-checklist";
import { Link } from "@/i18n/navigation";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

const SECTIONS: ReadonlyArray<{ href: string; title: string; description: string }> = [
  {
    href: "/dashboard/agent/business",
    title: "Business",
    description: "The name your AI announces and your time zone.",
  },
  {
    href: "/dashboard/agent/greeting",
    title: "Greeting & Persona",
    description: "Your AI's name and exactly what callers hear first.",
  },
  {
    href: "/dashboard/agent/hours",
    title: "Hours",
    description: "Weekly hours, holidays, special hours, and the booking window.",
  },
  {
    href: "/dashboard/agent/services",
    title: "Services",
    description: "What your AI can book or sell, with lengths and prices.",
  },
  {
    href: "/dashboard/agent/instructions",
    title: "AI Instructions",
    description: "Transfer number, when to transfer, and extra details.",
  },
  {
    href: "/dashboard/agent/vertical-details",
    title: "Vertical details",
    description: "Policies and details specific to your kind of business, reminders and reviews.",
  },
  {
    href: "/dashboard/delivery",
    title: "Alerts",
    description: "Which phone and email get new-message and booking alerts.",
  },
  {
    href: "/dashboard/test-agent",
    title: "Test your agent",
    description: "Call it yourself and review the transcript before going live.",
  },
];

/**
 * `/dashboard/agent` — agent Overview (SETTINGS-1). FRONTEND_SPEC §6.6 had
 * this route redirect to `/greeting`; the settings audit asked for one
 * place an owner can see which key settings are still empty, so it now
 * renders the Settings checklist plus a map of every settings section
 * (including the Test agent page, which had no sidebar entry).
 */
export default function AgentOverviewPage() {
  const tenantId = useCurrentTenantId();
  if (!tenantId) return null;
  return (
    <div className="space-y-6">
      <SettingsChecklist tenantId={tenantId} />
      <div className="grid gap-3 sm:grid-cols-2">
        {SECTIONS.map((section) => (
          <Link key={section.href} href={section.href} className="group">
            <Card interactive className="h-full">
              <CardContent className="flex items-start justify-between gap-3 pt-6">
                <div>
                  <p className="text-sm font-medium">{section.title}</p>
                  <p className="text-xs text-muted-foreground">{section.description}</p>
                </div>
                <ChevronRight
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
                  aria-hidden
                />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
