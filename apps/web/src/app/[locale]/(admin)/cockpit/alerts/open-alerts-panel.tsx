"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@heyloo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

export interface OpenAlert {
  id: string;
  rule: string;
  severity: "info" | "warning" | "critical";
  tenant_id: string | null;
  tenant_name?: string | null;
  payload: unknown;
  created_at: string;
}

const SEVERITY_VARIANT = {
  critical: "destructive",
  warning: "warning",
  info: "outline",
} as const;

/** Compact `key: value` summary of an alert payload (the payload is free-form jsonb; a scalar or array is shown as-is). */
function summarizePayload(payload: unknown): string {
  if (payload === null || payload === undefined) return "—";
  if (typeof payload !== "object" || Array.isArray(payload)) return String(payload).slice(0, 120);
  const entries = Object.entries(payload as Record<string, unknown>)
    .filter(([, value]) => value !== null && typeof value !== "object")
    .slice(0, 4)
    .map(([key, value]) => `${key.replace(/_/g, " ")}: ${String(value)}`);
  return entries.length > 0 ? entries.join(" · ") : "—";
}

/**
 * COCKPIT-F07: fired alerts, with an Ack action. The page used to read only the
 * alert RULES, so every fired alert (259 open rows) was invisible and could
 * never be cleared.
 */
export function OpenAlertsPanel() {
  const queryClient = useQueryClient();
  const query = useAdminQuery<{ alerts: OpenAlert[] }>("alerts-open", [], "admin-alerts");
  const [acking, setAcking] = useState<string | null>(null);

  async function ack(alert: OpenAlert) {
    setAcking(alert.id);
    try {
      const res = await fetch(`/api/admin/admin-alerts/${alert.id}/ack`, { method: "PATCH" });
      // 404 = someone else already acked it: the list is stale, not the action failed.
      if (res.ok || res.status === 404) {
        toast.success(res.ok ? "Alert acknowledged" : "That alert was already acknowledged");
        await queryClient.invalidateQueries({ queryKey: ["admin", "alerts-open"] });
      } else {
        toast.error("Couldn't acknowledge the alert. Please try again.");
      }
    } finally {
      setAcking(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Open alerts</CardTitle>
      </CardHeader>
      <CardContent>
        <DataState
          query={query}
          empty={{
            title: "No open alerts",
            isEmpty: (d) => (d?.alerts ?? []).length === 0,
          }}
          render={(data) => (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Severity</TableHead>
                  <TableHead>Rule</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Fired</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.alerts.map((alert) => (
                  <TableRow key={alert.id}>
                    <TableCell>
                      <Badge variant={SEVERITY_VARIANT[alert.severity] ?? "outline"}>
                        {alert.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{alert.rule.replace(/_/g, " ")}</TableCell>
                    <TableCell>
                      {alert.tenant_name ?? (alert.tenant_id ? "Unknown" : "Platform")}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">
                      {summarizePayload(alert.payload)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {new Date(alert.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={acking === alert.id}
                        onClick={() => void ack(alert)}
                        aria-label={`Acknowledge ${alert.rule.replace(/_/g, " ")} alert`}
                      >
                        Ack
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        />
      </CardContent>
    </Card>
  );
}
