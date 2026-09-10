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
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

const OAUTH_PROVIDERS = new Set(["square", "google_calendar"]);

const STATUS_META: Record<
  IntegrationStatus["status"],
  { label: string; variant: "outline" | "success" | "destructive" }
> = {
  disconnected: { label: "Not connected", variant: "outline" },
  connected: { label: "Connected", variant: "success" },
  error: { label: "Needs reauthorization", variant: "destructive" },
};

/**
 * Tenant-facing adapter Integrations page (E2E_FLOWS_AUDIT Flow 9/10 gap —
 * "no 'Connect <adapter>' UI in the tenant dashboard at all"; nav entry
 * already wired in `tenant-shell-client.tsx`, this file fills the route).
 * Lists the four two-way sync adapters `api-adapter-connect` supports
 * (Square, Google Calendar, Shopmonkey, ezyVet) with real connect/
 * reconnect/disconnect actions, live status, last-refreshed time, and any
 * revocation error — never a decorative control (CLAUDE.md).
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
      const payload =
        provider === "ezyvet"
          ? { provider, base_url: pasteValue.trim() }
          : { provider, api_key: pasteValue.trim() };
      const res = await fetch("/api/tenant/integrations/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
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
            : body.error === "ezyvet_practice_not_authorized"
              ? "This practice hasn't authorized Heyloo yet in ezyVet."
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
        description="Connect the systems you already use so bookings and orders sync automatically."
      />

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
              const meta = STATUS_META[integration.status];
              const isOAuth = OAUTH_PROVIDERS.has(integration.provider);
              const isPending = pending === integration.provider;
              return (
                <Card key={integration.provider}>
                  <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
                    <CardTitle className="text-base">{integration.display_name}</CardTitle>
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      {integration.status === "connected" && integration.last_refreshed_at
                        ? `Last refreshed ${new Date(integration.last_refreshed_at).toLocaleString()}`
                        : integration.status === "error"
                          ? (integration.last_error ??
                            "The provider revoked access — reconnect to resume syncing.")
                          : "Not connected yet."}
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
                        <Label htmlFor={`paste-${integration.provider}`}>
                          {integration.provider === "ezyvet" ? "Practice base URL" : "API key"}
                        </Label>
                        <Input
                          id={`paste-${integration.provider}`}
                          value={pasteValue}
                          onChange={(e) => setPasteValue(e.target.value)}
                          placeholder={
                            integration.provider === "ezyvet"
                              ? "https://your-practice.ezyvet.com"
                              : "sk_..."
                          }
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
                        Connect
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
