"use client";

import {
  type AlertRule,
  AlertRuleRow,
  DataState,
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@heyloo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

export default function AlertsPage() {
  const queryClient = useQueryClient();
  const query = useAdminQuery<{ rules: AlertRule[] }>("alert-rules", [], "admin-alerts");

  async function toggle(rule: AlertRule, enabled: boolean) {
    const res = await fetch(`/api/admin/admin-alerts/${rule.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (res.ok) void queryClient.invalidateQueries({ queryKey: ["admin", "alert-rules"] });
    else toast.error("Couldn't update the rule yet — backend endpoint pending.");
  }

  async function test(rule: AlertRule) {
    const res = await fetch(`/api/admin/admin-alerts/${rule.id}/test`, { method: "POST" });
    if (res.ok) toast.success("Test alert sent");
    else toast.error("Test alert isn't available yet.");
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Alert rules</h1>
      <DataState
        query={query}
        empty={{ title: "No alert rules configured yet" }}
        render={(data) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Metric</TableHead>
                <TableHead>Threshold</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Last triggered</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rules.map((rule) => (
                <AlertRuleRow
                  key={rule.id}
                  rule={rule}
                  onEdit={() => toast.info("Rule editor coming soon.")}
                  onToggle={toggle}
                  onTest={test}
                />
              ))}
            </TableBody>
          </Table>
        )}
      />
    </div>
  );
}
