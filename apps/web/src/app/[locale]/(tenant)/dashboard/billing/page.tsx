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
import { toast } from "sonner";
import type { TenantPlanResponse } from "@/app/api/platform-settings/tenant-plan/route";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

interface Invoice {
  id: string;
  period_start: string;
  period_end: string;
  total_cents: number;
  status: string;
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
    cell: ({ row }) => formatCentsUSD(row.original.total_cents),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge variant="invoice" value={row.original.status} />,
  },
];

export default function BillingPage() {
  const tenantId = useCurrentTenantId();

  const usageQuery = useQuery({
    queryKey: ["tenant", tenantId, "usage_daily", "billing"],
    queryFn: async () => {
      const monthStart = new Date();
      monthStart.setDate(1);
      const [{ data }, { data: tenantRow }, planRes] = await Promise.all([
        supabaseBrowserClient
          .from("usage_daily")
          .select("billable_minutes, text_messages_out")
          .eq("tenant_id", tenantId as string)
          .gte("date", monthStart.toISOString().slice(0, 10)),
        supabaseBrowserClient
          .from("tenants")
          .select("usage_hard_cap_minutes")
          .eq("id", tenantId as string)
          .maybeSingle(),
        fetch("/api/platform-settings/tenant-plan"),
      ]);
      const used = (data ?? []).reduce((sum, r) => sum + (Number(r.billable_minutes ?? 0) || 0), 0);
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
        included: plan?.included_minutes ?? 0,
        alertThresholds: plan?.usage_alert_thresholds ?? { warn_pct: 0.8, critical_pct: 1.0 },
        hardCapMinutes: tenantRow?.usage_hard_cap_minutes ?? null,
        textMessagesUsed,
        includedTextConversations: plan?.included_text_conversations ?? 200,
        textConversationOverageCents: plan?.text_conversation_overage_cents ?? 5,
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
        .order("period_start", { ascending: false });
      return (data ?? []) as Invoice[];
    },
    enabled: !!tenantId,
  });

  async function openPortal() {
    const res = await fetch("/api/billing/portal", { method: "POST" });
    const body = (await res.json()) as { url?: string };
    if (res.ok && body.url) window.location.href = body.url;
    else toast.error("Billing portal isn't available yet — please contact support.");
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Billing" description="Usage, payment method, and invoices." />

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
              </p>
              <div className="space-y-2 border-t border-border pt-4 text-sm">
                <div className="flex items-center justify-between">
                  <span>
                    Alert at {Math.round(usage.alertThresholds.warn_pct * 100)}% of included minutes
                  </span>
                  <span className="text-muted-foreground">On (platform default)</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>
                    Alert at {Math.round(usage.alertThresholds.critical_pct * 100)}% of included
                    minutes
                  </span>
                  <span className="text-muted-foreground">On (platform default)</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Hard cap</span>
                  <span className="text-muted-foreground">
                    {usage.hardCapMinutes
                      ? `${usage.hardCapMinutes} min/mo (set by Heyloo support)`
                      : "Not set — contact support to enable"}
                  </span>
                </div>
              </div>
              <Button variant="outline" onClick={openPortal}>
                Manage payment method
              </Button>
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
              <p className="font-medium">{formatCentsUSD(row.total_cents)}</p>
              <StatusBadge variant="invoice" value={row.status} className="mt-1" />
            </div>
          )}
        />
      </div>
    </div>
  );
}
