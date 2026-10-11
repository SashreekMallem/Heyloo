"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataState,
  DataTable,
  PageHeader,
  Progress,
  StatusBadge,
  UsageMeter,
} from "@heyloo/ui";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import type { TenantPlanResponse } from "@/app/api/platform-settings/tenant-plan/route";
import { localMonthStart } from "@/lib/billing-period";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCanWriteSettings, useCurrentTenantId } from "@/lib/tenant/tenant-context";

interface Invoice {
  id: string;
  period_start: string;
  period_end: string;
  total_cents: number;
  status: string;
}

/** A $0 invoice (the one Stripe issues when a free trial starts) charged nothing: say so. */
function invoiceTotal(totalCents: number): string {
  return totalCents === 0 ? `${formatCentsUSD(0)} (no charge)` : formatCentsUSD(totalCents);
}

const columns: ColumnDef<Invoice, unknown>[] = [
  {
    accessorKey: "period_start",
    header: "Period",
    cell: ({ row }) => `${row.original.period_start} – ${row.original.period_end}`,
  },
  {
    accessorKey: "total_cents",
    header: "Total",
    cell: ({ row }) => invoiceTotal(row.original.total_cents),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge variant="invoice" value={row.original.status} />,
  },
];

const SUPPORT_MAILTO = "mailto:support@heyloo.com?subject=Billing%20help";

/** TRIAL-1: the tenant's free trial as the billing page explains it. */
interface FreeTrialInfo {
  /** The scheduled end while it runs, the actual end once over. */
  endsAt: string;
  endedReason: "time" | "minutes" | "canceled" | null;
  minutesCap: number | null;
  minutesUsed: number;
  timezone: string | null | undefined;
  /** The owner canceled during the trial: it ends with the trial, unpaid. */
  cancelScheduled?: boolean;
}

function formatTrialDate(iso: string, timezone: string | null | undefined): string {
  const options: Intl.DateTimeFormatOptions = { month: "long", day: "numeric", year: "numeric" };
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: timezone ?? undefined }).format(
      new Date(iso),
    );
  } catch {
    return new Intl.DateTimeFormat("en-US", options).format(new Date(iso));
  }
}

function freeTrialIsRunning(trial: FreeTrialInfo | null, now: Date = new Date()): boolean {
  return !!trial && trial.endedReason === null && Date.parse(trial.endsAt) > now.getTime();
}

/** Why the meter shows fewer minutes than were answered this month. */
function trialMinutesNote(minutes: number): string {
  if (minutes <= 0) return "";
  const whole = Math.round(minutes);
  if (whole < 1) return " Free-trial minutes this month aren't counted here.";
  return ` The ${whole} free-trial ${whole === 1 ? "minute" : "minutes"} this month ${whole === 1 ? "isn't" : "aren't"} counted here.`;
}

/** `YYYY-MM-DD` of an instant in the tenant's time zone (the browser's when
 * unknown), comparable with `localMonthStart`. */
function localDateOf(iso: string, timeZone: string | null | undefined): string {
  const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit" };
  try {
    return new Intl.DateTimeFormat("en-CA", { ...options, timeZone: timeZone ?? undefined }).format(
      new Date(iso),
    );
  } catch {
    return new Intl.DateTimeFormat("en-CA", options).format(new Date(iso));
  }
}

/** What the owner is told about their free trial, in plain words. */
export function freeTrialSummary(
  trial: FreeTrialInfo,
  options: { canManageBilling: boolean; now?: Date },
): string {
  const now = options.now ?? new Date();
  const date = formatTrialDate(trial.endsAt, trial.timezone);
  const cap = trial.minutesCap;
  if (trial.cancelScheduled && (trial.endedReason === null || trial.endedReason === "canceled")) {
    // The owner canceled in the billing portal: the subscription ends with the
    // trial and the plan is never charged (the minutes cap never ends such a
    // trial early).
    return freeTrialIsRunning(trial, now)
      ? `You canceled during your free trial, so your subscription ends when the trial ends on ${date}` +
          `${cap ? ` (${Math.min(Math.floor(trial.minutesUsed), cap)} of ${cap} trial minutes used)` : ""}. ` +
          "You won't be charged, and calls are answered until then."
      : "Your subscription was canceled during the free trial, so your plan was never charged.";
  }
  if (freeTrialIsRunning(trial, now)) {
    return (
      `Your free trial ends on ${date}` +
      (cap
        ? ` or when your AI receptionist has answered ${cap} minutes of calls, whichever comes first`
        : "") +
      `. ${cap ? `${Math.min(Math.floor(trial.minutesUsed), cap)} of ${cap} minutes used so far. ` : ""}` +
      "Then your plan starts and the monthly plan price is charged to your card on file. " +
      "Calls are never cut off. " +
      (options.canManageBilling
        ? "To cancel before you're charged, use Manage payment method below."
        : "Your account owner can cancel before you're charged.")
    );
  }
  switch (trial.endedReason) {
    case "minutes":
      return `Your free trial ended early because its ${cap ?? "trial"} call minutes were used, so your plan has started. Minutes used during the trial are never billed as overage.`;
    case "canceled":
      return "Your subscription was canceled during the free trial, so your plan was never charged.";
    default:
      return `Your free trial ended on ${date} and your plan started. Minutes used during the trial are never billed as overage.`;
  }
}

/** What to tell the owner when the billing portal could not be opened (edge-function error codes). */
export function portalErrorMessage(code: string | undefined): string {
  switch (code) {
    case "not_tenant_owner":
      return "Only the account owner can change the payment method.";
    case "no_billing_account":
      return "There's no billing account yet — finish checkout first.";
    default:
      return "The billing portal is temporarily unavailable.";
  }
}

export default function BillingPage() {
  const tenantId = useCurrentTenantId();
  const [portalIssue, setPortalIssue] = useState<string | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);
  const canManageBilling = useCanWriteSettings();

  const usageQuery = useQuery({
    queryKey: ["tenant", tenantId, "usage_daily", "billing"],
    queryFn: async () => {
      // Usage is bucketed by the TENANT's own local date and billed per tenant-local
      // calendar month (job-billing-cycle), so "this period" starts on the 1st in
      // the tenant's time zone, not the browser's (BILL-12).
      const { data: tenantRow } = await supabaseBrowserClient
        .from("tenants")
        .select(
          "usage_hard_cap_minutes, timezone, trial_ends_at, trial_minutes_cap, trial_ended_reason, trial_cancel_scheduled",
        )
        .eq("id", tenantId as string)
        .maybeSingle();
      const trialEndsAt = tenantRow?.trial_ends_at ?? null;
      const periodStart = localMonthStart(tenantRow?.timezone);
      const [{ data }, planRes, trialUsage] = await Promise.all([
        supabaseBrowserClient
          .from("usage_daily")
          .select("billable_minutes, text_messages_out")
          .eq("tenant_id", tenantId as string)
          .gte("date", periodStart),
        fetch("/api/platform-settings/tenant-plan"),
        // TRIAL-1: trial minutes are billable usage before the trial's end (the
        // minutes cap's own rule); only read for a tenant that had a trial.
        trialEndsAt
          ? supabaseBrowserClient
              .from("usage_events")
              .select("minutes, occurred_at")
              .eq("tenant_id", tenantId as string)
              .eq("is_billable", true)
              .lt("occurred_at", trialEndsAt)
          : Promise.resolve({ data: [] as { minutes: number; occurred_at: string }[] }),
      ]);
      const trialRows = trialUsage.data ?? [];
      const trial: FreeTrialInfo | null = trialEndsAt
        ? {
            endsAt: trialEndsAt,
            endedReason: tenantRow?.trial_ended_reason ?? null,
            minutesCap: tenantRow?.trial_minutes_cap ?? null,
            minutesUsed: trialRows.reduce((sum, r) => sum + (Number(r.minutes) || 0), 0),
            timezone: tenantRow?.timezone,
            cancelScheduled: tenantRow?.trial_cancel_scheduled === true,
          }
        : null;
      const totalUsed = (data ?? []).reduce(
        (sum, r) => sum + (Number(r.billable_minutes ?? 0) || 0),
        0,
      );
      // Trial minutes never count against the plan (job-billing-cycle bills
      // only usage from the trial's end): the meter shows what the plan pays
      // for, so a trial that ended mid-month never shows phantom overage.
      const trialMinutesThisPeriod = trialRows
        .filter(
          (r) => r.occurred_at && localDateOf(r.occurred_at, tenantRow?.timezone) >= periodStart,
        )
        .reduce((sum, r) => sum + (Number(r.minutes) || 0), 0);
      const used = Math.max(0, totalUsed - trialMinutesThisPeriod);
      // BACKEND_SPEC.md §13.3 — same "AI-generated text replies, SMS + web
      // chat combined" total the Website Widget Install page's own usage
      // tile shows; billed against the plan's included_text_conversations
      // allowance here, which that page (a self-service settings surface,
      // not a billing one) deliberately doesn't attempt.
      const textMessagesUsed = (data ?? []).reduce(
        (sum, r) => sum + (Number(r.text_messages_out ?? 0) || 0),
        0,
      );
      const plan = planRes.ok ? ((await planRes.json()) as TenantPlanResponse) : null;
      return {
        used,
        trialMinutesThisPeriod,
        included: plan?.included_minutes ?? 0,
        alertThresholds: plan?.usage_alert_thresholds ?? { warn_pct: 0.8, critical_pct: 1.0 },
        hardCapMinutes: tenantRow?.usage_hard_cap_minutes ?? null,
        textMessagesUsed,
        includedTextConversations: plan?.included_text_conversations ?? 200,
        textConversationOverageCents: plan?.text_conversation_overage_cents ?? 5,
        trial,
      };
    },
    enabled: !!tenantId,
  });

  const invoicesQuery = useQuery({
    queryKey: ["tenant", tenantId, "billing_invoices"],
    queryFn: async () => {
      const { data } = await supabaseBrowserClient
        .from("billing_invoices")
        .select("id, period_start, period_end, total_cents, status")
        .eq("tenant_id", tenantId as string)
        // `void` rows are internal markers (job-billing-cycle records a usage
        // computation for a period Stripe already invoiced): showing them next to
        // the real Stripe invoice would look like a second, cancelled charge.
        .neq("status", "void")
        // A `draft` invoice is Stripe's not-yet-finalized preview of the
        // current period — showing "$299.00 Draft" next to real invoices
        // reads as a charge that already happened (QA-1 F-25).
        .neq("status", "draft")
        .order("period_start", { ascending: false });
      return (data ?? []) as Invoice[];
    },
    enabled: !!tenantId,
  });

  async function openPortal() {
    setPortalIssue(null);
    setOpeningPortal(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok && body.url) {
        window.location.href = body.url;
        return;
      }
      setPortalIssue(portalErrorMessage(body.error));
    } catch {
      setPortalIssue(portalErrorMessage(undefined));
    } finally {
      setOpeningPortal(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Billing" description="Usage, payment method, and invoices." />

      {usageQuery.data?.trial && (
        <Card data-testid="free-trial-card">
          <CardHeader>
            <CardTitle className="text-base">Free trial</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              {freeTrialSummary(usageQuery.data.trial, { canManageBilling })}
            </p>
          </CardContent>
        </Card>
      )}

      <DataState
        query={usageQuery}
        empty={{ title: "No usage data yet" }}
        render={(usage) => (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Usage this period</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <UsageMeter
                includedMinutes={usage.included}
                usedMinutes={usage.used}
                overageMinutes={Math.max(0, usage.used - usage.included)}
              />
              <p className="text-xs text-muted-foreground">
                Test calls from your registered cell don&apos;t count toward usage.
                {freeTrialIsRunning(usage.trial)
                  ? " Minutes used during your free trial are never billed as overage."
                  : ""}
                {trialMinutesNote(usage.trialMinutesThisPeriod)}
              </p>
              <div className="space-y-2 border-t border-border pt-4 text-sm">
                <div className="flex items-center justify-between">
                  <span>
                    Alert at {Math.round(usage.alertThresholds.warn_pct * 100)}% of included minutes
                  </span>
                  <span className="text-muted-foreground">Not sending yet — coming soon</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>
                    Alert at {Math.round(usage.alertThresholds.critical_pct * 100)}% of included
                    minutes
                  </span>
                  <span className="text-muted-foreground">Not sending yet — coming soon</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Hard cap</span>
                  <span className="text-muted-foreground">
                    {usage.hardCapMinutes
                      ? `${usage.hardCapMinutes} min/mo noted by Heyloo support — not enforced automatically yet`
                      : "Not set — contact support to enable"}
                  </span>
                </div>
              </div>
              {canManageBilling ? (
                <>
                  <Button variant="outline" onClick={openPortal} disabled={openingPortal}>
                    Manage payment method
                  </Button>
                  {portalIssue && (
                    <p role="alert" className="text-sm text-destructive">
                      {portalIssue}{" "}
                      <a href={SUPPORT_MAILTO} className="underline underline-offset-2">
                        Email support
                      </a>{" "}
                      and we&apos;ll update your payment method for you.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground" data-testid="billing-owner-only">
                  Ask your account owner to manage the payment method.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      />

      <DataState
        query={usageQuery}
        empty={{ title: "No usage data yet" }}
        render={(usage) => {
          const included = usage.includedTextConversations;
          const used = usage.textMessagesUsed;
          const overage = Math.max(0, used - included);
          const pct = included > 0 ? Math.min(100, (used / included) * 100) : 0;
          return (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Text conversations usage this period</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">
                    {used.toLocaleString()} of {included.toLocaleString()} AI text replies used
                  </span>
                  {overage > 0 && (
                    <span className="text-xs font-medium text-destructive">
                      +{overage.toLocaleString()} over ·{" "}
                      {formatCentsUSD(overage * usage.textConversationOverageCents)}
                    </span>
                  )}
                </div>
                <Progress
                  value={pct}
                  indicatorClassName={
                    pct >= 100 ? "bg-destructive" : pct >= 80 ? "bg-warning" : "bg-primary"
                  }
                  aria-label="AI text replies used this period"
                />
                <p className="text-xs text-muted-foreground">
                  Counts every AI-generated reply over SMS and your website chat widget combined —{" "}
                  {formatCentsUSD(usage.textConversationOverageCents)} per reply beyond your plan.
                </p>
              </CardContent>
            </Card>
          );
        }}
      />

      <div>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Invoices</h2>
        <DataTable
          columns={columns}
          data={invoicesQuery.data ?? []}
          emptyState={{ title: "No invoices yet" }}
          renderMobileCard={(row) => (
            <div className="rounded-lg border border-border p-3 text-sm">
              <p>
                {row.period_start} – {row.period_end}
              </p>
              <p className="font-medium">{invoiceTotal(row.total_cents)}</p>
              <StatusBadge variant="invoice" value={row.status} className="mt-1" />
            </div>
          )}
        />
      </div>
    </div>
  );
}
