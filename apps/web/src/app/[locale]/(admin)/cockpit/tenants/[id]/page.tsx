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
  StatusBadge,
  Textarea,
} from "@heyloo/ui";
import { use, useState } from "react";
import { toast } from "sonner";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

interface TenantDetail {
  id: string;
  name: string;
  status: string;
  plan_code: string;
  vertical: string;
  mrr_cents: number;
  margin_pct: number;
  minutes_used: number;
}

export default function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const query = useAdminQuery<TenantDetail>("tenant-detail", [id], `admin-tenants/${id}`);
  const [impersonateOpen, setImpersonateOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reason, setReason] = useState("");

  async function impersonate() {
    const res = await fetch(`/api/admin/admin-tenants/${id}/impersonate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenant_id: id, reason }),
    });
    setImpersonateOpen(false);
    if (res.ok) toast.success("Impersonation session started");
    else toast.error("Impersonation isn't available yet.");
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
        render={(tenant) => (
          <>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-semibold">{tenant.name}</h1>
                <StatusBadge variant="tenant" value={tenant.status} />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setImpersonateOpen(true)}>
                  Impersonate
                </Button>
                <Button variant="destructive" onClick={() => setSuspendOpen(true)}>
                  Suspend
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <MetricCard label="MRR" value={tenant.mrr_cents} format="currency" />
              <MetricCard label="Margin %" value={tenant.margin_pct} format="percent" />
              <MetricCard label="Minutes used" value={tenant.minutes_used} format="number" />
            </div>
          </>
        )}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent calls</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
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
