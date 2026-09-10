"use client";

import {
  Callout,
  Card,
  CardContent,
  ConnectionLifecycleCard,
  Input,
  Label,
  PageHeader,
  Switch,
} from "@heyloo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { AirtableStatusResponse } from "@/app/api/tenant/delivery/airtable/status/route";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

interface DeliveryPrefs {
  sms_enabled: boolean;
  email_enabled: boolean;
  notification_email: string;
}

const DEFAULT_PREFS: DeliveryPrefs = {
  sms_enabled: true,
  email_enabled: true,
  notification_email: "",
};

export default function DeliveryPage() {
  const tenantId = useCurrentTenantId();
  const queryClient = useQueryClient();
  const [prefs, setPrefs] = useState<DeliveryPrefs>(DEFAULT_PREFS);
  const [a2pStatus, setA2pStatus] = useState<string>("pending_verification");
  const [loaded, setLoaded] = useState(false);

  useQuery({
    queryKey: ["tenant", tenantId, "agent_configs", "delivery"],
    queryFn: async () => {
      const { data: config } = await supabaseBrowserClient
        .from("agent_configs")
        .select("dynamic_variable_overrides")
        .eq("tenant_id", tenantId as string)
        .maybeSingle();
      const { data: tenant } = await supabaseBrowserClient
        .from("tenants")
        .select("a2p_status")
        .eq("id", tenantId as string)
        .maybeSingle();
      const overrides = (config?.dynamic_variable_overrides ?? {}) as { delivery?: DeliveryPrefs };
      setPrefs(overrides.delivery ?? DEFAULT_PREFS);
      setA2pStatus(tenant?.a2p_status ?? "pending_verification");
      setLoaded(true);
      return null;
    },
    enabled: !!tenantId,
  });

  async function save(next: DeliveryPrefs) {
    setPrefs(next);
    const { data: current } = await supabaseBrowserClient
      .from("agent_configs")
      .select("dynamic_variable_overrides")
      .eq("tenant_id", tenantId as string)
      .maybeSingle();
    const overrides = (current?.dynamic_variable_overrides ?? {}) as Record<string, unknown>;
    const { error } = await supabaseBrowserClient
      .from("agent_configs")
      .update({ dynamic_variable_overrides: { ...overrides, delivery: next } })
      .eq("tenant_id", tenantId as string);
    if (error) toast.error("Couldn't save — please try again.");
    else void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "agent_configs"] });
  }

  const airtableQuery = useQuery({
    queryKey: ["tenant", tenantId, "adapter_connections", "airtable"],
    queryFn: async (): Promise<AirtableStatusResponse> => {
      const res = await fetch("/api/tenant/delivery/airtable/status");
      return (await res.json()) as AirtableStatusResponse;
    },
    enabled: !!tenantId,
  });

  const [syncLogOpen, setSyncLogOpen] = useState(false);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Fixed-origin check (FRONTEND_SPEC.md §6.8) — never trust a message
      // from any origin but our own popup.
      if (event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; ok?: boolean; error?: string } | null;
      if (data?.source !== "heyloo-airtable-oauth") return;
      if (data.ok) {
        toast.success("Airtable connected");
      } else {
        toast.error(
          data.error === "airtable_oauth_not_configured"
            ? "Airtable connect isn't configured yet — contact support."
            : "Couldn't connect Airtable — please try again.",
        );
      }
      void queryClient.invalidateQueries({
        queryKey: ["tenant", tenantId, "adapter_connections"],
      });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [queryClient, tenantId]);

  function connectAirtable() {
    window.open(
      "/api/tenant/delivery/airtable/connect",
      "heyloo-airtable-connect",
      "width=520,height=640",
    );
  }

  async function disconnectAirtable() {
    const res = await fetch("/api/tenant/delivery/airtable/disconnect", { method: "POST" });
    if (res.ok) {
      toast.success("Airtable disconnected");
      void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "adapter_connections"] });
    } else {
      toast.error("Couldn't disconnect — please try again.");
    }
  }

  async function syncNowAirtable() {
    const res = await fetch("/api/tenant/delivery/airtable/sync-now", { method: "POST" });
    const body = (await res.json()) as { enqueued?: number; pending?: number };
    if (res.ok) {
      toast.success(`Sync queued for ${body.enqueued ?? 0} record(s)`);
      void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "adapter_connections"] });
    } else {
      toast.error("Sync isn't available yet — we've flagged it for the team.");
    }
  }

  if (!loaded) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Delivery preferences"
        description="Choose how you and your customers hear about calls, bookings, and orders."
      />

      {a2pStatus === "pending_verification" && (
        <Callout tone="warning" title="SMS pending carrier verification">
          Carrier approval usually takes 1–5 business days — email delivery stays active in the
          meantime.
        </Callout>
      )}

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center justify-between">
            <Label htmlFor="sms-enabled">SMS notifications</Label>
            <Switch
              id="sms-enabled"
              checked={prefs.sms_enabled}
              onCheckedChange={(checked) => void save({ ...prefs, sms_enabled: checked })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="email-enabled">Email notifications</Label>
            <Switch
              id="email-enabled"
              checked={prefs.email_enabled}
              onCheckedChange={(checked) => void save({ ...prefs, email_enabled: checked })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="notification-email">Notification email</Label>
            <Input
              id="notification-email"
              value={prefs.notification_email}
              onChange={(e) => setPrefs({ ...prefs, notification_email: e.target.value })}
              onBlur={() => void save(prefs)}
            />
          </div>
        </CardContent>
      </Card>

      <ConnectionLifecycleCard
        provider="Airtable"
        status={airtableQuery.data?.status ?? "disconnected"}
        lastSyncAt={airtableQuery.data?.last_synced_at ?? undefined}
        onConnect={connectAirtable}
        onDisconnect={() => void disconnectAirtable()}
        onSyncNow={() => void syncNowAirtable()}
      />

      {airtableQuery.data && airtableQuery.data.sync_log.length > 0 && (
        <div className="rounded-lg border border-border">
          <button
            type="button"
            className="w-full px-3 py-2 text-left text-sm font-medium"
            onClick={() => setSyncLogOpen((v) => !v)}
          >
            {syncLogOpen ? "Hide" : "Show"} sync log ({airtableQuery.data.sync_log.length})
          </button>
          {syncLogOpen && (
            <ul className="divide-y divide-border border-t border-border text-sm">
              {airtableQuery.data.sync_log.map((row) => (
                <li
                  key={`${row.entity_type}-${row.entity_id}`}
                  className="flex items-center justify-between px-3 py-2"
                >
                  <span>
                    {row.entity_type} {row.entity_id.slice(0, 8)}
                  </span>
                  <span className={row.sync_conflict ? "text-warning" : "text-muted-foreground"}>
                    {row.sync_conflict
                      ? "Conflict — edited in Airtable since last sync"
                      : row.last_synced_at
                        ? new Date(row.last_synced_at).toLocaleString()
                        : "Not yet synced"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
