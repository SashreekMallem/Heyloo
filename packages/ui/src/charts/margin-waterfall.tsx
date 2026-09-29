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

export interface WaterfallBucket {
  label: string;
  kind: WaterfallSegmentKind;
  /** Signed change this segment contributes (a `total` is its absolute amount). */
  delta: number;
  /** Running total AFTER this segment. */
  runningTotal: number;
  /** Invisible stack offset (signed): positive above zero, negative below. */
  base: number;
  /** Visible height above zero (>= 0). */
  pos: number;
  /** Visible height below zero (<= 0). */
  neg: number;
}

/**
 * Bars span [lo, hi] between the running total before and after a segment.
 * The old implementation clamped the invisible base at 0, so once the running
 * total went negative (e.g. a period with cost but no paid revenue) every
 * subtract bar was drawn upward from zero instead of hanging below it.
 * Splitting each bar into an above-zero part and a below-zero part lets Recharts
 * stack the positive and negative sides independently, so a bar that starts
 * above zero and ends below it renders as one continuous bar.
 */
export function buildWaterfallBuckets(segments: WaterfallSegment[]): WaterfallBucket[] {
  let running = 0;
  return segments.map((segment) => {
    const start = segment.kind === "total" ? 0 : running;
    const delta = segment.kind === "subtract" ? -segment.amount : segment.amount;
    const end = segment.kind === "total" ? segment.amount : running + delta;
    running = end;
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    return {
      label: segment.label,
      kind: segment.kind,
      delta: segment.kind === "total" ? segment.amount : delta,
      runningTotal: end,
      base: lo >= 0 ? lo : hi <= 0 ? hi : 0,
      pos: Math.max(hi, 0) - Math.max(lo, 0),
      neg: Math.min(lo, 0) - Math.min(hi, 0),
    };
  });
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
  const buckets = useMemo<WaterfallBucket[]>(() => buildWaterfallBuckets(segments), [segments]);

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
          content={({ active, payload }) => {
            const bucket = active
              ? (payload?.[0]?.payload as WaterfallBucket | undefined)
              : undefined;
            if (!bucket) return null;
            return (
              <div
                style={{
                  background: "var(--color-popover)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  fontSize: 12,
                  padding: "6px 10px",
                }}
              >
                {bucket.label}: {formatCentsUSD(bucket.delta)}
              </div>
            );
          }}
        />
        <Bar dataKey="base" stackId="waterfall" fill="transparent" isAnimationActive={false} />
        {(["pos", "neg"] as const).map((key) => (
          <Bar
            key={key}
            dataKey={key}
            stackId="waterfall"
            radius={[4, 4, 4, 4]}
            isAnimationActive={false}
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
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
