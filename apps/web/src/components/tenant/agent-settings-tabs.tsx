"use client";

import { Tabs, TabsList, TabsTrigger } from "@heyloo/ui";
import type { ReactNode } from "react";
import { Link, usePathname, useRouter } from "@/i18n/navigation";

const TABS = [
  { value: "greeting", label: "Greeting & Persona" },
  { value: "hours", label: "Hours" },
  { value: "services", label: "Services" },
  { value: "faq", label: "FAQ" },
  { value: "instructions", label: "AI Instructions" },
  { value: "manual-mode", label: "Manual Mode" },
  { value: "language", label: "Language" },
];

export function AgentSettingsTabs({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const active = TABS.find((t) => pathname.endsWith(t.value))?.value ?? "greeting";

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Agent settings</h1>

      {/* Desktop tabs */}
      <Tabs value={active} className="hidden sm:block">
        <TabsList>
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} asChild>
              <Link href={`/dashboard/agent/${tab.value}`}>{tab.label}</Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Mobile select switcher (FRONTEND_SPEC.md §6.6 — tabs don't scroll well cramped below `sm`) */}
      <select
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm sm:hidden"
        value={active}
        onChange={(e) => router.push(`/dashboard/agent/${e.target.value}`)}
      >
        {TABS.map((tab) => (
          <option key={tab.value} value={tab.value}>
            {tab.label}
          </option>
        ))}
      </select>

      {children}
    </div>
  );
}
