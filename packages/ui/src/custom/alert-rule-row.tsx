"use client";

import { Beaker, Pencil } from "lucide-react";
import { Button } from "../primitives/button.js";
import { Switch } from "../primitives/switch.js";
import { TableCell, TableRow } from "../primitives/table.js";

export interface AlertRule {
  id: string;
  metric: string;
  operator: string;
  value: number;
  enabled: boolean;
  channel: "email" | "sms" | "dashboard_only";
  lastTriggeredAt?: string | null;
}

export interface AlertRuleRowProps {
  rule: AlertRule;
  onEdit: (rule: AlertRule) => void;
  onToggle: (rule: AlertRule, enabled: boolean) => void;
  onTest: (rule: AlertRule) => void;
}

/** One alert-rule row + edit affordance — admin alerts (FRONTEND_SPEC.md §1.3/§7.1.9). "Test alert" sends a sample through the real channel. */
export function AlertRuleRow({ rule, onEdit, onToggle, onTest }: AlertRuleRowProps) {
  return (
    <TableRow>
      <TableCell className="font-medium">{rule.metric.replace(/_/g, " ")}</TableCell>
      <TableCell>
        {rule.operator} {rule.value}
      </TableCell>
      <TableCell className="capitalize">{rule.channel.replace("_", " ")}</TableCell>
      <TableCell>
        {rule.lastTriggeredAt ? new Date(rule.lastTriggeredAt).toLocaleString() : "Never"}
      </TableCell>
      <TableCell>
        <Switch checked={rule.enabled} onCheckedChange={(checked) => onToggle(rule, checked)} />
      </TableCell>
      <TableCell className="flex gap-1">
        <Button size="sm" variant="ghost" onClick={() => onEdit(rule)}>
          <Pencil className="size-3.5" /> Edit
        </Button>
        <Button size="sm" variant="outline" onClick={() => onTest(rule)}>
          <Beaker className="size-3.5" /> Test
        </Button>
      </TableCell>
    </TableRow>
  );
}
