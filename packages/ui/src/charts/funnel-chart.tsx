"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "../lib/utils.js";

export interface FunnelStage {
  label: string;
  count: number;
}

export interface FunnelChartProps {
  stages: FunnelStage[];
  height?: number;
  className?: string;
}

/** Sent→opened→replied→qualified→signed-up (outreach) / clicks→signups→qualified→paid (referrals/partners) — FRONTEND_SPEC.md §1.3. */
export function FunnelChart({ stages, height = 240, className }: FunnelChartProps) {
  return (
    <div className={cn(className)}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={stages}
          layout="vertical"
          margin={{ top: 8, right: 24, bottom: 8, left: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            tickLine={false}
            axisLine={false}
            fontSize={12}
            width={110}
            stroke="var(--color-muted-foreground)"
          />
          <Tooltip
            contentStyle={{
              background: "var(--color-popover)",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Bar dataKey="count" fill="var(--color-primary)" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
