"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface DriftPoint {
  label: string;
  voice: number;
  llm: number;
  telephony: number;
}

export interface DriftMarker {
  label: string;
  provider: keyof Omit<DriftPoint, "label">;
  value: number;
}

export interface DriftLineChartProps {
  data: DriftPoint[];
  markers?: DriftMarker[];
  height?: number;
}

/** `/cockpit/margin/drift` — $/min cost over time per provider, with drift markers past the configured threshold (FRONTEND_SPEC.md §7.1.4). */
export function DriftLineChart({ data, markers = [], height = 280 }: DriftLineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          fontSize={12}
          stroke="var(--color-muted-foreground)"
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          fontSize={12}
          stroke="var(--color-muted-foreground)"
          width={56}
        />
        <Tooltip
          contentStyle={{
            background: "var(--color-popover)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            fontSize: 12,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line
          type="monotone"
          dataKey="voice"
          stroke="var(--color-primary)"
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="llm"
          stroke="var(--color-accent-foreground)"
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="telephony"
          stroke="var(--color-warning)"
          strokeWidth={2}
          dot={false}
        />
        {markers.map((marker) => (
          <ReferenceDot
            key={`${marker.label}-${marker.provider}`}
            x={marker.label}
            y={marker.value}
            r={5}
            fill="var(--color-destructive)"
            stroke="none"
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
