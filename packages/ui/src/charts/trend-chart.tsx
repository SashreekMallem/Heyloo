"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface TrendChartPoint {
  label: string;
  value: number;
}

export interface TrendChartProps {
  data: TrendChartPoint[];
  color?: string;
  height?: number;
  valueFormatter?: (value: number) => string;
}

/** Overview trend chart (FRONTEND_SPEC.md §6.1) — simplifies to a sparkline on narrow viewports via `height`. */
export function TrendChart({
  data,
  color = "var(--color-primary)",
  height = 220,
  valueFormatter,
}: TrendChartProps) {
  // Coerce every value to a finite number — an upstream row with a
  // wrong-typed/missing value (e.g. a non-numeric `value`) must never
  // silently collapse Recharts' auto axis-domain calculation into the
  // "two faint lines and nothing else" degenerate render (round-3 tenant
  // design review, medium).
  const safeData = data.map((point) => ({
    ...point,
    value: Number.isFinite(point.value) ? point.value : 0,
  }));
  const allZero = safeData.length === 0 || safeData.every((point) => point.value === 0);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={safeData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.35} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          fontSize={12}
          stroke="var(--color-muted-foreground)"
        />
        <YAxis
          // At all-zero (or empty) data, Recharts' auto domain collapses to
          // a single value and renders no visible ticks/baseline — force a
          // real 0-4 domain so a flat baseline with labeled ticks always
          // shows, matching the empty-but-labeled pattern used by
          // `FunnelChart` for an all-zero referral funnel.
          domain={allZero ? [0, 4] : ["auto", "auto"]}
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          fontSize={12}
          stroke="var(--color-muted-foreground)"
          width={40}
        />
        <Tooltip
          formatter={(value) => {
            const numeric = typeof value === "number" ? value : Number(value ?? 0);
            return valueFormatter ? valueFormatter(numeric) : numeric;
          }}
          contentStyle={{
            background: "var(--color-popover)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            fontSize: 12,
          }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          fill="url(#trendFill)"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
