"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataState,
  Input,
  Label,
  PageHeader,
  Skeleton,
} from "@heyloo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type {
  IntegrationStatus,
  IntegrationsListResponse,
} from "@/app/api/tenant/integrations/route";
import { isOAuthProvider } from "@/app/api/tenant/integrations/shared";
import { WebhooksCard } from "@/components/tenant/webhooks-card";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

const STATUS_META: Record<
  IntegrationStatus["status"],
  { label: string; variant: "outline" | "success" | "destructive" }
> = {
  disconnected: { label: "Not connected", variant: "outline" },
  connected: { label: "Connected", variant: "success" },
  error: { label: "Needs reconnect", variant: "destructive" },
};

/** Owner-facing status line. Never the raw `last_error` (internal strings like "square 401 on booking push"). */
function statusText(integration: IntegrationStatus, comingSoon: boolean): string {
  if (integration.status === "connected") {
    return integration.last_refreshed_at
      ? `Last refreshed ${new Date(integration.last_refreshed_at).toLocaleString()}`
      : "Connected.";
  }
  if (integration.status === "error") {
    return comingSoon
      ? `${integration.display_name} stopped accepting Heyloo's connection, so syncing has stopped. Reconnecting will be possible once this integration is available again.`
      : `${integration.display_name} stopped accepting Heyloo's connection, so syncing has stopped. Reconnect to resume.`;
  }
  return comingSoon
    ? "Coming soon. Until then, send bookings and orders to any app with webhooks above."
    : "Not connected yet.";
}

/**
 * Tenant-facing Integrations page (E2E_FLOWS_AUDIT Flow 9/10 gap —
 * "no 'Connect <adapter>' UI in the tenant dashboard at all"; nav entry
 * already wired in `tenant-shell-client.tsx`, this file fills the route).
 *
 * OUTBOUND-1: the Webhooks card at the top sends every booking, order and
 * taken message to Zapier/Make/n8n/any HTTPS endpoint.
 *
 * Below it, the four two-way sync adapters `api-adapter-connect` supports
 * (Square, Google Calendar, Shopmonkey, ezyVet) with live status and
 * last-refreshed time. CONNECT-SAFE-1: a provider the API marks
 * `available: false` reads "Coming soon" with a disabled Connect (the
 * connect route refuses it too); an existing connection stays visible and
 * can still be disconnected. A connection that broke reads "Needs
 * reconnect" with friendly copy, never the raw stored reason.
 *
 * Airtable is a separate one-way delivery integration with its own page
 * (`/dashboard/delivery`) and isn't duplicated here.
 */
export default function IntegrationsPage() {
  const tenantId = useCurrentTenantId();
  const queryClient = useQueryClient();
  const [pasteKeyOpenFor, setPasteKeyOpenFor] = useState<string | null>(null);
  const [pasteValue, setPasteValue] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["tenant", tenantId, "integrations"],
    queryFn: async (): Promise<IntegrationsListResponse> => {
      const res = await fetch("/api/tenant/integrations");
      if (!res.ok) throw new Error("failed_to_load_integrations");
      return (await res.json()) as IntegrationsListResponse;
    },
    enabled: !!tenantId,
  });

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        source?: string;
        ok?: boolean;
        provider?: string;
        error?: string;
      } | null;
      if (data?.source !== "heyloo-adapter-oauth") return;
      if (data.ok) {
        toast.success(`${data.provider ?? "Adapter"} connected`);
      } else {
        toast.error(`Couldn't connect ${data.provider ?? "adapter"} — please try again.`);
      }
      void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "integrations"] });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [queryClient, tenantId]);

  async function connectOAuth(provider: string) {
    setPending(provider);
    try {
      const res = await fetch("/api/tenant/integrations/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        authorize_url?: string;
        error?: string;
      };
      if (!res.ok || !body.authorize_url) {
        toast.error("Couldn't start the connection — please try again.");
        return;
      }
      window.open(body.authorize_url, `heyloo-connect-${provider}`, "width=520,height=640");
    } finally {
      setPending(null);
    }
  }

  async function submitPasteKey(provider: string) {
    if (!pasteValue.trim()) return;
    setPending(provider);
    try {
      const res = await fetch("/api/tenant/integrations/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, api_key: pasteValue.trim() }),
      });
      if (res.ok) {
        toast.success("Connected");
        setPasteKeyOpenFor(null);
        setPasteValue("");
        void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "integrations"] });
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(
          body.error === "shopmonkey_api_key_invalid"
            ? "That API key wasn't accepted by Shopmonkey."
            : body.error === "provider_coming_soon"
              ? "This integration isn't available yet."
              : "Couldn't connect — please check the details and try again.",
        );
      }
    } finally {
      setPending(null);
    }
  }

  async function disconnect(provider: string) {
    setPending(provider);
    try {
      const res = await fetch("/api/tenant/integrations/disconnect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      if (res.ok) {
        toast.success("Disconnected");
        void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "integrations"] });
      } else {
        toast.error("Couldn't disconnect — please try again.");
      }
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Send bookings, orders and messages to the apps you already use."
      />

      {tenantId && <WebhooksCard tenantId={tenantId} />}

      <h2 className="text-base font-medium">Sync with your booking or POS system</h2>
      <DataState
        query={query}
        empty={{
          title: "No integrations available",
          description: "Check back once integrations are configured for your business type.",
          // Defensive: don't assume `integrations` is present — a response
          // that doesn't match IntegrationsListResponse must read as empty,
          // never throw.
          isEmpty: (data) => !Array.isArray(data.integrations) || data.integrations.length === 0,
        }}
        loadingSkeleton={
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton count, never reordered
              <Skeleton key={i} className="h-32 w-full rounded-lg" />
            ))}
          </div>
        }
        render={(data) => (
          <div className="grid gap-4 sm:grid-cols-2">
            {data.integrations.map((integration) => {
              const meta = STATUS_META[integration.status] ?? STATUS_META.disconnected;
              const isOAuth = isOAuthProvider(integration.provider);
              const isPending = pending === integration.provider;
              // A response without the field (older API, preview fixture) is available.
              const comingSoon = integration.available === false;
              const showComingSoonBadge = comingSoon && integration.status === "disconnected";
              return (
                <Card
                  key={integration.provider}
                  role="group"
                  aria-labelledby={`integration-${integration.provider}-title`}
                >
                  <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
                    <CardTitle
                      id={`integration-${integration.provider}-title`}
                      className="text-base"
                    >
                      {integration.display_name}
                    </CardTitle>
                    {showComingSoonBadge ? (
                      <Badge variant="secondary">Coming soon</Badge>
                    ) : (
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      {statusText(integration, comingSoon)}
                    </p>

                    {!integration.can_manage ? (
                      <p className="text-xs text-muted-foreground">
                        Only the account owner or an admin can manage integrations.
                      </p>
                    ) : integration.status === "connected" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        onClick={() => void disconnect(integration.provider)}
                      >
                        Disconnect
                      </Button>
                    ) : comingSoon ? (
                      <Button size="sm" disabled>
                        Connect
                      </Button>
                    ) : isOAuth ? (
                      <Button
                        size="sm"
                        disabled={isPending}
                        onClick={() => void connectOAuth(integration.provider)}
                      >
                        {integration.status === "error" ? "Reconnect" : "Connect"}
                      </Button>
                    ) : pasteKeyOpenFor === integration.provider ? (
                      <div className="space-y-2">
                        <Label htmlFor={`paste-${integration.provider}`}>API key</Label>
                        <Input
                          id={`paste-${integration.provider}`}
                          value={pasteValue}
                          onChange={(e) => setPasteValue(e.target.value)}
                          placeholder="sk_..."
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={isPending}
                            onClick={() => void submitPasteKey(integration.provider)}
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setPasteKeyOpenFor(null);
                              setPasteValue("");
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => {
                          setPasteKeyOpenFor(integration.provider);
                          setPasteValue("");
                        }}
                      >
                        {integration.status === "error" ? "Reconnect" : "Connect"}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      />
    </div>
  );
}
