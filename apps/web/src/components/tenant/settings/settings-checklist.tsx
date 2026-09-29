"use client";

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@heyloo/ui";
import { CheckCircle2, ChevronRight, Circle } from "lucide-react";
import type { SettingsChecklistResponse } from "@/app/api/tenant/settings/checklist/route";
import { Link } from "@/i18n/navigation";
import { useTenantQuery } from "@/lib/hooks/use-tenant-query";

/**
 * SETTINGS-1: the agent Overview's "Settings checklist" — which key
 * settings are still empty (transfer number, hours, services, bookable
 * resources, alert recipients, publish state), each linking to where it's
 * set. Computed server-side from real rows (`GET /api/tenant/settings/
 * checklist`); every settings save invalidates `settings_checklist`.
 */
export function SettingsChecklist({ tenantId }: { tenantId: string }) {
  const query = useTenantQuery(
    tenantId,
    "settings_checklist",
    [],
    async (): Promise<SettingsChecklistResponse | null> => {
      const res = await fetch("/api/tenant/settings/checklist");
      if (!res.ok) return null;
      const body = (await res.json()) as Partial<SettingsChecklistResponse>;
      return Array.isArray(body.items) ? (body as SettingsChecklistResponse) : null;
    },
  );

  if (query.isPending) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }
  const data = query.data;
  if (!data) return null;
  const allDone = data.requiredDone === data.requiredTotal;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Settings checklist</CardTitle>
          <Badge variant={allDone ? "success" : "warning"}>
            {data.requiredDone} of {data.requiredTotal} done
          </Badge>
        </div>
        <CardDescription>
          {allDone
            ? "Every key setting is in place."
            : "These settings are still empty — your AI works best once they're set."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border rounded-md border border-border">
          {data.items.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className="flex items-start gap-3 px-3 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {item.done ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                ) : (
                  <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {item.label}
                    <span className="sr-only">{item.done ? "(done)" : "(not set)"}</span>
                    {item.optional && (
                      <span className="text-xs font-normal text-muted-foreground">Optional</span>
                    )}
                  </span>
                  <span className="block text-xs text-muted-foreground">{item.detail}</span>
                </span>
                <ChevronRight
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
