"use client";

import {
  CallFeedItem,
  Callout,
  DataState,
  DateRangePills,
  type DateRangePreset,
  MetricCard,
  PageHeader,
  TrendChart,
} from "@heyloo/ui";
import { useState } from "react";
import type { TenantPlanResponse } from "@/app/api/platform-settings/tenant-plan/route";
import { SetupProgressPanel } from "@/components/tenant/setup-progress-panel";
import { Link, useRouter } from "@/i18n/navigation";
import { useTenantQuery } from "@/lib/hooks/use-tenant-query";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

interface OverviewData {
  callsToday: number;
  bookingsToday: number;
  minutesUsed: number;
  minutesIncluded: number;
  spamDeflected: number;
  trend: { label: string; value: number }[];
}

interface RecentCall {
  id: string;
  callerNumber: string | null;
  classification: string | null;
  startedAt: string | null;
  durationSeconds: number | null;
}

function rangeDays(preset: DateRangePreset): number {
  return preset === "today" ? 1 : preset === "7d" ? 7 : 30;
}

export function OverviewClient({
  tenantId,
  hasPhoneNumber,
  hasAnyCallEver,
  liveNumber,
}: {
  tenantId: string;
  hasPhoneNumber: boolean;
  hasAnyCallEver: boolean;
  liveNumber: string | null;
}) {
  const [preset, setPreset] = useState<DateRangePreset>("7d");
  const router = useRouter();

  const overviewQuery = useTenantQuery(
    tenantId,
    "usage_daily",
    [preset],
    async (): Promise<OverviewData> => {
      const days = rangeDays(preset);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const [{ data: usage }, { count: spamCount }, planRes] = await Promise.all([
        supabaseBrowserClient
          .from("usage_daily")
          .select("date, total_calls, total_minutes, billable_minutes, total_bookings")
          .eq("tenant_id", tenantId)
          .gte("date", since)
          .order("date", { ascending: true }),
        supabaseBrowserClient
          .from("call_logs")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("classification", "spam_robocall")
          .gte("started_at", `${since}T00:00:00.000Z`),
        fetch("/api/platform-settings/tenant-plan"),
      ]);

      const rows = usage ?? [];
      const today = new Date().toISOString().slice(0, 10);
      const todayRow = rows.find((r) => r.date === today);
      const plan = planRes.ok ? ((await planRes.json()) as TenantPlanResponse) : null;

      return {
        callsToday: todayRow?.total_calls ?? 0,
        bookingsToday: todayRow?.total_bookings ?? 0,
        minutesUsed: rows.reduce((sum, r) => sum + Number(r.billable_minutes), 0),
        minutesIncluded: plan?.included_minutes ?? 0,
        spamDeflected: spamCount ?? 0,
        trend: rows.map((r) => ({ label: r.date.slice(5), value: r.total_calls })),
      };
    },
  );

  const callsQuery = useTenantQuery(
    tenantId,
    "call_logs",
    ["recent"],
    async (): Promise<RecentCall[]> => {
      const { data } = await supabaseBrowserClient
        .from("call_logs")
        .select("id, caller_number, classification, started_at, duration_seconds")
        .eq("tenant_id", tenantId)
        .order("started_at", { ascending: false })
        .limit(20);
      return (data ?? []).map((c) => ({
        id: c.id,
        callerNumber: c.caller_number,
        classification: c.classification,
        startedAt: c.started_at,
        durationSeconds: c.duration_seconds,
      }));
    },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        actions={<DateRangePills value={preset} onChange={setPreset} tenantTz="America/New_York" />}
      />

      <SetupProgressPanel tenantId={tenantId} />

      <DataState
        query={overviewQuery}
        empty={{ title: "No data yet" }}
        errorEventId={undefined}
        render={(data) => (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <MetricCard label="Calls today" value={data.callsToday} format="number" />
              <MetricCard label="Bookings today" value={data.bookingsToday} format="number" />
              <MetricCard label="Minutes used" value={data.minutesUsed} format="number" />
              <MetricCard label="Spam deflected" value={data.spamDeflected} format="number" />
            </div>
            <div className="mt-6 rounded-lg border border-border p-4">
              <TrendChart data={data.trend} />
            </div>
          </>
        )}
      />

      <div>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Recent calls</h2>
        <DataState
          query={callsQuery}
          empty={
            !hasPhoneNumber
              ? {
                  title: "Number not yet forwarded",
                  description: "Once your number is forwarded, calls land here.",
                  action: {
                    label: "Finish phone setup",
                    onClick: () => router.push("/dashboard/phone-setup"),
                  },
                }
              : !hasAnyCallEver
                ? {
                    title: "Forwarded, zero calls yet",
                    description: "Try calling your number to see how it works.",
                  }
                : { title: "No calls in this range", description: "Try a wider date range." }
          }
          render={(calls) => (
            <div className="divide-y divide-border rounded-lg border border-border">
              {calls.map((call) => (
                <CallFeedItem
                  key={call.id}
                  call={call}
                  onClick={() => router.push(`/dashboard/calls/${call.id}`)}
                />
              ))}
            </div>
          )}
        />
      </div>

      {!hasPhoneNumber && (
        <Callout tone="info" title="Your number isn't connected yet">
          <Link href="/dashboard/phone-setup" className="font-medium underline">
            Finish phone setup
          </Link>{" "}
          to start receiving calls.
        </Callout>
      )}
      {hasPhoneNumber && !hasAnyCallEver && liveNumber && (
        <Callout tone="neutral" title="Try it out">
          Test your number:{" "}
          <a href={`tel:${liveNumber}`} className="font-medium underline">
            {liveNumber}
          </a>
        </Callout>
      )}
    </div>
  );
}
