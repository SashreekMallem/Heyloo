"use client";

import { CallFeedItem, Callout, DataState, MetricCard, PageHeader, Skeleton } from "@heyloo/ui";
import { TrendChart } from "@heyloo/ui/charts";
import { DateRangePills, type DateRangePreset } from "@heyloo/ui/date-range";
import { useState } from "react";
import type { TenantPlanResponse } from "@/app/api/platform-settings/tenant-plan/route";
import { SetupProgressPanel } from "@/components/tenant/setup-progress-panel";
import { Link, useRouter } from "@/i18n/navigation";
import { useTenantQuery } from "@/lib/hooks/use-tenant-query";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import {
  tenantDateKey,
  tenantDateKeyDaysAgo,
  tenantDayStartIso,
  tenantMidnightIso,
} from "@/lib/tenant/tz";

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

interface UsageDailyRow {
  date: string;
  total_calls: number | null;
}

/**
 * `usage_daily` rows -> `TrendChart`'s `{ label, value }[]` shape. Exported
 * so the adapter itself is unit-testable without rendering Recharts (which
 * needs a real layout/ResizeObserver jsdom lacks) — the earlier inline
 * `rows.map(...)` passed a possibly-null `total_calls` straight through,
 * relying entirely on `TrendChart`'s own defensive coercion; this makes
 * "every point is a finite number" the adapter's own contract.
 */
export function usageDailyToTrend(rows: UsageDailyRow[]): { label: string; value: number }[] {
  return rows.map((r) => ({ label: r.date.slice(5), value: Number(r.total_calls ?? 0) }));
}

/**
 * Puts the live "today" call count on the trend chart's last point. The
 * `usage_daily` rollup is at best hourly, so today's own row is missing or
 * stale — the chart used to end two days ago (QA-1 F-02).
 */
export function withLiveToday(
  trend: { label: string; value: number }[],
  todayKey: string,
  todayCalls: number,
): { label: string; value: number }[] {
  const label = todayKey.slice(5);
  const rest = trend.filter((p) => p.label !== label);
  return [...rest, { label, value: todayCalls }];
}

/** Skeleton with the same footprint as the loaded metrics + chart, so the page doesn't jump when data arrives (QA-1 MAP-07). */
function OverviewSkeleton() {
  return (
    <div data-testid="overview-skeleton">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {["Calls today", "Bookings today", "Minutes used", "Spam deflected"].map((label) => (
          <MetricCard key={label} label={label} value={0} format="number" loading />
        ))}
      </div>
      <div className="mt-6 rounded-lg border border-border p-4">
        <Skeleton className="h-[220px] w-full" />
      </div>
    </div>
  );
}

export function OverviewClient({
  tenantId,
  tenantTz,
  hasPhoneNumber,
  hasAnyCallEver,
  liveNumber,
}: {
  tenantId: string;
  /** The tenant's IANA timezone: every "today" / range boundary is tenant-local, never UTC. */
  tenantTz: string;
  hasPhoneNumber: boolean;
  hasAnyCallEver: boolean;
  liveNumber: string | null;
}) {
  const [preset, setPreset] = useState<DateRangePreset>("7d");
  const router = useRouter();

  const overviewQuery = useTenantQuery(
    tenantId,
    "usage_daily",
    [preset, tenantTz],
    async (): Promise<OverviewData> => {
      const days = rangeDays(preset);
      const now = new Date();
      const todayKey = tenantDateKey(tenantTz, now);
      const todayStart = tenantDayStartIso(tenantTz, now);
      // Inclusive of today: "7d" = today + the six previous tenant-local days.
      const sinceKey = tenantDateKeyDaysAgo(tenantTz, days - 1, now);
      const sinceIso = tenantMidnightIso(tenantTz, sinceKey);

      const [{ data: usage }, { count: spamCount }, todayCallsRes, todayBookingsRes, planRes] =
        await Promise.all([
          supabaseBrowserClient
            .from("usage_daily")
            .select("date, total_calls, total_minutes, billable_minutes, total_bookings")
            .eq("tenant_id", tenantId)
            .gte("date", sinceKey)
            .order("date", { ascending: true }),
          supabaseBrowserClient
            .from("call_logs")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenantId)
            .in("channel", ["phone", "web_voice"])
            .eq("is_test_call", false)
            .eq("classification", "spam_robocall")
            .gte("started_at", sinceIso),
          // "Today" headline numbers are computed live from the source tables in
          // the tenant-local day: usage_daily is a rollup that lags (QA-1 F-02/F-21).
          supabaseBrowserClient
            .from("call_logs")
            .select("duration_seconds", { count: "exact" })
            .eq("tenant_id", tenantId)
            .in("channel", ["phone", "web_voice"])
            .eq("is_test_call", false)
            .gte("started_at", todayStart)
            .limit(1000),
          supabaseBrowserClient
            .from("bookings")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenantId)
            .eq("is_test", false)
            .gte("created_at", todayStart),
          fetch("/api/platform-settings/tenant-plan"),
        ]);

      const rows = usage ?? [];
      const plan = planRes.ok ? ((await planRes.json()) as TenantPlanResponse) : null;

      const todayCalls = todayCallsRes.count ?? todayCallsRes.data?.length ?? 0;
      const todaySeconds = (todayCallsRes.data ?? []).reduce(
        (sum, c) => sum + (Number(c.duration_seconds ?? 0) || 0),
        0,
      );
      const todayMinutes = Math.ceil(todaySeconds / 60);
      // Earlier days come from the rollup; today is live (its rollup row, if any, is stale).
      const priorMinutes = rows
        .filter((r) => r.date !== todayKey)
        .reduce((sum, r) => sum + (Number(r.billable_minutes ?? 0) || 0), 0);

      return {
        callsToday: todayCalls,
        bookingsToday: todayBookingsRes.count ?? 0,
        minutesUsed: Math.round(priorMinutes + todayMinutes),
        minutesIncluded: plan?.included_minutes ?? 0,
        spamDeflected: spamCount ?? 0,
        trend: withLiveToday(usageDailyToTrend(rows), todayKey, todayCalls),
      };
    },
  );

  const callsQuery = useTenantQuery(
    tenantId,
    "call_logs",
    ["recent", preset, tenantTz],
    async (): Promise<RecentCall[]> => {
      const sinceIso = tenantMidnightIso(
        tenantTz,
        tenantDateKeyDaysAgo(tenantTz, rangeDays(preset) - 1),
      );
      const { data, error } = await supabaseBrowserClient
        .from("call_logs")
        .select("id, caller_number, classification, started_at, duration_seconds")
        .eq("tenant_id", tenantId)
        // Voice-only "Recent calls" widget: exclude text-agent shadow rows
        // (channel 'sms'/'web_chat') — see calls-list-client.tsx for the
        // same NULLS FIRST hazard this also avoids.
        .in("channel", ["phone", "web_voice"])
        // The date-range pills drive this list too (QA-1 F-14).
        .gte("started_at", sinceIso)
        .order("started_at", { ascending: false, nullsFirst: false })
        .limit(20);
      if (error) throw new Error(error.message);
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
        actions={<DateRangePills value={preset} onChange={setPreset} tenantTz={tenantTz} />}
      />

      <SetupProgressPanel tenantId={tenantId} />

      <DataState
        query={overviewQuery}
        empty={{ title: "No data yet" }}
        loadingSkeleton={<OverviewSkeleton />}
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
