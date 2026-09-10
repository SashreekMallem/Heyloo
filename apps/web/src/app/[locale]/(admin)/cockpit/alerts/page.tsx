"use client";

import { ALERT_METRICS, adminAlertThresholdSchema } from "@heyloo/canonical-types";
import {
  type AlertRule,
  AlertRuleRow,
  Button,
  DataState,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@heyloo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

type RuleDraft = {
  metric: (typeof ALERT_METRICS)[number];
  operator: "gt" | "gte" | "lt" | "lte" | "eq";
  value: number;
  enabled: boolean;
  channel: "email" | "sms" | "dashboard_only";
};

const EMPTY_DRAFT: RuleDraft = {
  metric: ALERT_METRICS[0],
  operator: "gt",
  value: 0,
  enabled: true,
  channel: "dashboard_only",
};

export default function AlertsPage() {
  const queryClient = useQueryClient();
  const query = useAdminQuery<{ rules: AlertRule[] }>("alert-rules", [], "admin-alerts/rules");
  const [editing, setEditing] = useState<AlertRule | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<RuleDraft>(EMPTY_DRAFT);

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: ["admin", "alert-rules"] });
  }

  async function toggle(rule: AlertRule, enabled: boolean) {
    const res = await fetch(`/api/admin/admin-alerts/rules/${rule.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (res.ok) void invalidate();
    else toast.error("Couldn't update the rule — please try again.");
  }

  async function test(rule: AlertRule) {
    const res = await fetch(`/api/admin/admin-alerts/${rule.id}/test`, { method: "POST" });
    if (res.ok) toast.success("Test alert sent");
    else toast.error("Test alert isn't available yet.");
  }

  function openCreate() {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setDialogOpen(true);
  }

  function openEdit(rule: AlertRule) {
    setEditing(rule);
    setDraft({
      metric: rule.metric as RuleDraft["metric"],
      operator: rule.operator as RuleDraft["operator"],
      value: rule.value,
      enabled: rule.enabled,
      channel: rule.channel,
    });
    setDialogOpen(true);
  }

  async function saveDraft() {
    const parsed = adminAlertThresholdSchema.safeParse(draft);
    if (!parsed.success) {
      toast.error("Check the rule's fields.");
      return;
    }
    const res = editing
      ? await fetch(`/api/admin/admin-alerts/rules/${editing.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(parsed.data),
        })
      : await fetch("/api/admin/admin-alerts/rules", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(parsed.data),
        });
    if (res.ok) {
      toast.success(editing ? "Rule updated" : "Rule created");
      setDialogOpen(false);
      void invalidate();
    } else {
      toast.error("Couldn't save the rule — please try again.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Alert rules</h1>
        <Button onClick={openCreate}>New rule</Button>
      </div>
      <DataState
        query={query}
        empty={{
          title: "No alert rules configured yet",
          action: { label: "New rule", onClick: openCreate },
        }}
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
                  onEdit={openEdit}
                  onToggle={toggle}
                  onTest={test}
                />
              ))}
            </TableBody>
          </Table>
        )}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit alert rule" : "New alert rule"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Metric</Label>
              <Select
                value={draft.metric}
                onValueChange={(v) => setDraft((d) => ({ ...d, metric: v as RuleDraft["metric"] }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALERT_METRICS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Operator</Label>
                <Select
                  value={draft.operator}
                  onValueChange={(v) =>
                    setDraft((d) => ({ ...d, operator: v as RuleDraft["operator"] }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["gt", "gte", "lt", "lte", "eq"] as const).map((op) => (
                      <SelectItem key={op} value={op}>
                        {op}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Value</Label>
                <Input
                  type="number"
                  value={draft.value}
                  onChange={(e) => setDraft((d) => ({ ...d, value: Number(e.target.value) }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Channel</Label>
              <Select
                value={draft.channel}
                onValueChange={(v) =>
                  setDraft((d) => ({ ...d, channel: v as RuleDraft["channel"] }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="dashboard_only">Dashboard only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label>Enabled</Label>
              <Switch
                checked={draft.enabled}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, enabled: v }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveDraft}>{editing ? "Save" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
