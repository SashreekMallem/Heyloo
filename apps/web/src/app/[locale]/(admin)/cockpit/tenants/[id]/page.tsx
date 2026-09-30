"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataState,
  Input,
  MetricCard,
  PageHeader,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from "@heyloo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { toast } from "sonner";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";
import { startImpersonation } from "@/lib/impersonation/state";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

interface TenantDetail {
  id: string;
  name: string;
  status: string;
  plan_code: string;
  vertical: string;
}

interface TenantMetrics {
  /** null = no live Stripe subscription, so no recurring revenue (COCKPIT-F14). */
  mrr_cents: number | null;
  /** The plan's list price; shown only as a caption when there is no subscription. */
  list_price_cents?: number;
  /** null = no paid revenue this month, so no margin (COCKPIT-F12). */
  margin_pct: number | null;
  minutes_used: number;
}

// The `admin` edge function's tenant-detail route responds
// `{ tenant: {...}, metrics: {...} }` (`supabase/functions/admin/
// handler.ts`'s `handleTenants` — `tenants` itself has no MRR/margin/
// minutes columns, so those are computed server-side from
// `v_tenant_margin`/`usage_daily`) — reading a flat `TenantDetail` off
// `query.data` left every metric tile blank (admin-partner design review
// round 5, major: page/API contract mismatch).
interface TenantDetailResponse {
  tenant: TenantDetail;
  metrics: TenantMetrics;
}

interface RecentCall {
  call_id: string;
  started_at: string;
  duration_seconds: number;
  cost_cents: number | null;
  cost_source: string | null;
  is_test: boolean;
}

function RecentCalls({ calls, loading }: { calls: RecentCall[] | undefined; loading: boolean }) {
  if (loading) return <p className="text-small text-muted-foreground">Loading…</p>;
  if (!calls || calls.length === 0) {
    return <p className="text-small text-muted-foreground">No calls this quarter.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Started</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Cost</TableHead>
          <TableHead>Cost source</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {calls.slice(0, 10).map((c) => (
          <TableRow key={c.call_id}>
            <TableCell>{new Date(c.started_at).toLocaleString()}</TableCell>
            <TableCell className="tabular-nums">{c.duration_seconds}s</TableCell>
            <TableCell className="tabular-nums">
              {c.cost_cents === null ? "—" : formatCentsUSD(c.cost_cents)}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {c.cost_source ?? "unknown"}
              {c.is_test ? " · test" : ""}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const query = useAdminQuery<TenantDetailResponse>("tenant-detail", [id], `admin-tenants/${id}`);
  // Read-only observability: this tenant's recent calls with provider cost
  // (same route as the margin drill-down — includes test calls, flagged).
  const callsQuery = useAdminQuery<{ calls: RecentCall[] }>(
    "tenant-recent-calls",
    [id],
    `admin-cockpit/per-customer-margin/${id}?period=quarter`,
    // Dependent card: never fetched (or shown) while the tenant itself failed to load.
    { enabled: query.isSuccess },
  );
  const [impersonateOpen, setImpersonateOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [impersonateReason, setImpersonateReason] = useState("");
  const [suspendReason, setSuspendReason] = useState("");
  const [busy, setBusy] = useState(false);

  function refresh() {
    return queryClient.invalidateQueries({ queryKey: ["admin", "tenant-detail", id] });
  }

  async function impersonate() {
    const reason = impersonateReason.trim();
    if (!reason) return; // the confirm button is disabled until a reason is typed
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/admin-tenants/${id}/impersonate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant_id: id, reason }),
      });
      // A failure leaves the dialog (and the typed reason) open so it can be retried.
      if (!res.ok) {
        toast.error(
          res.status === 501
            ? "Impersonation isn't available yet."
            : "Couldn't start impersonation — please try again.",
        );
        return;
      }
      const body = (await res.json()) as {
        impersonation_link?: string;
        tenant_id?: string;
        expires_at?: string;
      };
      if (!body.impersonation_link || !body.expires_at) {
        toast.error("Impersonation isn't available yet.");
        return;
      }
      const {
        data: { session: adminSession },
      } = await supabaseBrowserClient.auth.getSession();
      startImpersonation({
        tenantId: id,
        tenantName: query.data?.tenant.name ?? "this tenant",
        adminEmail: adminSession?.user.email ?? "an admin",
        expiresAt: body.expires_at,
        editMode: false,
      });
      setImpersonateOpen(false);
      window.open(body.impersonation_link, "_blank", "noopener");
      toast.success("Impersonation session started in a new tab");
    } finally {
      setBusy(false);
    }
  }

  /** PATCH the tenant's status; the reason (required to pause) is stored in the audit row. */
  async function setStatus(status: "paused" | "active", reason?: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/admin-tenants/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, ...(reason ? { reason } : {}) }),
      });
      if (!res.ok) {
        toast.error(
          status === "paused"
            ? "Couldn't suspend the tenant. Nothing was changed."
            : "Couldn't resume the tenant. Nothing was changed.",
        );
        return false;
      }
      toast.success(status === "paused" ? "Tenant suspended" : "Tenant resumed");
      await refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function suspend() {
    const reason = suspendReason.trim();
    if (!reason) return; // the confirm button is disabled until a reason is typed
    if (await setStatus("paused", reason)) {
      setSuspendOpen(false);
      setSuspendReason("");
    }
  }

  return (
    <div className="space-y-6">
      <DataState
        query={query}
        empty={{ title: "Tenant not found" }}
        render={({ tenant, metrics }) => (
          <>
            <PageHeader
              title={tenant.name || "Unnamed tenant"}
              description={<StatusBadge variant="tenant" value={tenant.status} />}
              actions={
                <>
                  <Button variant="outline" onClick={() => setImpersonateOpen(true)}>
                    Impersonate
                  </Button>
                  {tenant.status === "paused" ? (
                    <Button disabled={busy} onClick={() => void setStatus("active")}>
                      Resume tenant
                    </Button>
                  ) : (
                    tenant.status !== "canceled" && (
                      <Button variant="destructive" onClick={() => setSuspendOpen(true)}>
                        Suspend
                      </Button>
                    )
                  )}
                </>
              }
            />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="space-y-1">
                <MetricCard label="MRR" value={metrics.mrr_cents ?? Number.NaN} format="currency" />
                {metrics.mrr_cents === null && (
                  <p className="text-xs text-muted-foreground">
                    No active subscription
                    {metrics.list_price_cents
                      ? ` · list price ${formatCentsUSD(metrics.list_price_cents)}/mo`
                      : ""}
                  </p>
                )}
              </div>
              <MetricCard
                label="Margin %"
                value={metrics.margin_pct ?? Number.NaN}
                format="percent"
              />
              <MetricCard label="Minutes used" value={metrics.minutes_used} format="number" />
            </div>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent calls</CardTitle>
              </CardHeader>
              <CardContent>
                <RecentCalls calls={callsQuery.data?.calls} loading={callsQuery.isLoading} />
              </CardContent>
            </Card>
          </>
        )}
      />

      <AlertDialog open={impersonateOpen} onOpenChange={setImpersonateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Impersonate this tenant?</AlertDialogTitle>
            <AlertDialogDescription>
              This starts a read-only, time-boxed session and is logged to the audit trail even if
              you cancel.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            placeholder="Reason (required)"
            aria-label="Impersonation reason"
            value={impersonateReason}
            onChange={(e) => setImpersonateReason(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || !impersonateReason.trim()}
              onClick={(e) => {
                // Keep the dialog open until the request finishes (it closes itself in `impersonate`).
                e.preventDefault();
                void impersonate();
              }}
            >
              Start impersonation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={suspendOpen} onOpenChange={setSuspendOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Suspend this tenant?</AlertDialogTitle>
            <AlertDialogDescription>
              This stops their AI answering calls immediately. You can resume them from this page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="Reason (required)"
            aria-label="Suspension reason"
            value={suspendReason}
            onChange={(e) => setSuspendReason(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || !suspendReason.trim()}
              onClick={(e) => {
                // A failed request must not silently close the dialog and drop the typed reason.
                e.preventDefault();
                void suspend();
              }}
            >
              Suspend tenant
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
