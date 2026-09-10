"use client";

import { RefreshCw } from "lucide-react";
import { Badge } from "../primitives/badge.js";
import { Button } from "../primitives/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../primitives/card.js";

export type ConnectionStatus = "disconnected" | "connected" | "error";

export interface ConnectionLifecycleCardProps {
  provider: string;
  status: ConnectionStatus;
  lastSyncAt?: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onSyncNow: () => void;
}

const STATUS_META: Record<
  ConnectionStatus,
  { label: string; variant: "outline" | "success" | "destructive" }
> = {
  disconnected: { label: "Not connected", variant: "outline" },
  connected: { label: "Connected", variant: "success" },
  error: { label: "Needs reauthorization", variant: "destructive" },
};

/** Connect / reauth / disconnect / sync-now / last-sync — delivery preferences, adapters (FRONTEND_SPEC.md §1.3/§6.8). */
export function ConnectionLifecycleCard({
  provider,
  status,
  lastSyncAt,
  onConnect,
  onDisconnect,
  onSyncNow,
}: ConnectionLifecycleCardProps) {
  const meta = STATUS_META[status];
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{provider}</CardTitle>
        <Badge variant={meta.variant}>{meta.label}</Badge>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {status === "connected" && lastSyncAt
            ? `Last synced ${new Date(lastSyncAt).toLocaleString()}`
            : status === "error"
              ? "The provider revoked access — reconnect to resume pushes."
              : "Connect to enable two-way sync."}
        </p>
        <div className="flex gap-2">
          {status === "connected" && (
            <>
              <Button size="sm" variant="outline" onClick={onSyncNow}>
                <RefreshCw className="size-3.5" /> Sync now
              </Button>
              <Button size="sm" variant="ghost" onClick={onDisconnect}>
                Disconnect
              </Button>
            </>
          )}
          {status !== "connected" && (
            <Button size="sm" onClick={onConnect}>
              {status === "error" ? "Reconnect" : "Connect"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
