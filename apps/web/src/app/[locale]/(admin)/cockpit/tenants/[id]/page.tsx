"use client";

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
  Textarea,
} from "@heyloo/ui";
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
  mrr_cents: number;
  margin_pct: number;
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

export default function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const query = useAdminQuery<TenantDetailResponse>("tenant-detail", [id], `admin-tenants/${id}`);
  const [impersonateOpen, setImpersonateOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reason, setReason] = useState("");

  async function impersonate() {
    if (!reason.trim()) {
      toast.error("A reason is required for the audit log.");
      return;
    }
    const res = await fetch(`/api/admin/admin-tenants/${id}/impersonate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenant_id: id, reason }),
    });
    setImpersonateOpen(false);
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
    window.open(body.impersonation_link, "_blank", "noopener");
    toast.success("Impersonation session started in a new tab");
  }

  async function suspend() {
    const res = await fetch(`/api/admin/admin-tenants/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenant_id: id, reason, status: "paused" }),
    });
    setSuspendOpen(false);
    if (res.ok) toast.success("Tenant suspended");
    else toast.error("Couldn't suspend the tenant yet.");
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
                  <Button variant="destructive" onClick={() => setSuspendOpen(true)}>
                    Suspend
                  </Button>
                </>
              }
            />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <MetricCard label="MRR" value={metrics.mrr_cents} format="currency" />
              <MetricCard label="Margin %" value={metrics.margin_pct} format="percent" />
              <MetricCard label="Minutes used" value={metrics.minutes_used} format="number" />
            </div>
          </>
        )}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent calls</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-small text-muted-foreground">
            Read-only observability view — pending backend endpoint.
          </p>
        </CardContent>
      </Card>

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
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={impersonate}>Start impersonation</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={suspendOpen} onOpenChange={setSuspendOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Suspend this tenant?</AlertDialogTitle>
            <AlertDialogDescription>
              This stops their AI answering calls immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="Reason (required)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={suspend}>Suspend tenant</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
