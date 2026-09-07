"use client";

import { Card, CardContent, ConnectionLifecycleCard, Input, Label, Switch } from "@heyloo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
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

  if (!loaded) return null;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Delivery preferences</h1>

      {a2pStatus === "pending_verification" && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          SMS delivery is pending carrier verification (1–5 business days) — email delivery stays
          active in the meantime.
        </div>
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
            <Label>Notification email</Label>
            <Input
              value={prefs.notification_email}
              onChange={(e) => setPrefs({ ...prefs, notification_email: e.target.value })}
              onBlur={() => void save(prefs)}
            />
          </div>
        </CardContent>
      </Card>

      <ConnectionLifecycleCard
        provider="Airtable"
        status="disconnected"
        onConnect={() => toast.info("Airtable connect is coming soon.")}
        onDisconnect={() => {}}
        onSyncNow={() => {}}
      />
    </div>
  );
}
