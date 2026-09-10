"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState } from "../custom/empty-error-state.js";

export type WaterfallSegmentKind = "add" | "subtract" | "total";

export interface WaterfallSegment {
  label: string;
  amount: number; // cents, always positive magnitude — `kind` decides the sign drawn
  kind: WaterfallSegmentKind;
}

export interface MarginWaterfallProps {
  segments?: WaterfallSegment[];
  onSegmentClick?: (segment: WaterfallSegment) => void;
  height?: number;
}

interface Bucket {
  label: string;
  base: number; // invisible base offset
  value: number; // visible bar height
  kind: WaterfallSegmentKind;
  runningTotal: number;
}

/**
 * Waterfall chart via Recharts composed bars with an invisible base segment
 * (no native Recharts waterfall type — FRONTEND_SPEC.md §1.3/§7.1.1). If
 * this proves insufficient for future segment-annotation needs, `visx` is
 * the documented escape hatch (FRONTEND_STACK.md) — not needed for the
 * current margin-cockpit/Config Lab uses.
 */
export function MarginWaterfall({
  segments = [],
  onSegmentClick,
  height = 320,
}: MarginWaterfallProps) {
  const buckets = useMemo<Bucket[]>(() => {
    let running = 0;
    return segments.map((segment) => {
      if (segment.kind === "total") {
        const bucket: Bucket = {
          label: segment.label,
          base: 0,
          value: segment.amount,
          kind: segment.kind,
          runningTotal: segment.amount,
        };
        running = segment.amount;
        return bucket;
      }
      const delta = segment.kind === "add" ? segment.amount : -segment.amount;
      const base = delta >= 0 ? running : running + delta;
      running += delta;
      return {
        label: segment.label,
        base: Math.max(0, base),
        value: Math.abs(delta),
        kind: segment.kind,
        runningTotal: running,
      };
    });
  }, [segments]);

  if (buckets.length === 0) {
    return (
      <EmptyState
        title="No margin data yet"
        description="The waterfall fills in once this period has billed usage."
        className="w-full"
      />
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={buckets} margin={{ top: 16, right: 16, bottom: 8, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          fontSize={11}
          stroke="var(--color-muted-foreground)"
          interval={0}
          angle={-20}
          textAnchor="end"
          height={60}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          fontSize={12}
          stroke="var(--color-muted-foreground)"
          tickFormatter={(v: number) => formatCentsUSD(v)}
          width={70}
        />
        <Tooltip
          formatter={(_value, _name, item) => {
            const payload = (item as { payload?: Bucket }).payload;
            return payload ? [formatCentsUSD(payload.value), payload.label] : ["", ""];
          }}
          contentStyle={{
            background: "var(--color-popover)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            fontSize: 12,
          }}
        />
        <Bar dataKey="base" stackId="waterfall" fill="transparent" isAnimationActive={false} />
        <Bar
          dataKey="value"
          stackId="waterfall"
          radius={[4, 4, 4, 4]}
          onClick={(_data, index) => {
            const segment = segments[index];
            if (segment) onSegmentClick?.(segment);
          }}
          cursor={onSegmentClick ? "pointer" : undefined}
        >
          {buckets.map((bucket, index) => (
            <Cell
              // biome-ignore lint/suspicious/noArrayIndexKey: waterfall buckets are a fixed ordered sequence; label alone may repeat
              key={`${bucket.label}-${index}`}
              fill={
                bucket.kind === "total"
                  ? "var(--color-foreground)"
                  : bucket.kind === "add"
                    ? "var(--color-success)"
                    : "var(--color-destructive)"
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
