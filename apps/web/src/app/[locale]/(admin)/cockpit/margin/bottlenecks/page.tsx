"use client";

import { Badge, DataState, PageHeader } from "@heyloo/ui";
import { LatencyPercentileChart, type LatencyPoint } from "@heyloo/ui/charts";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

/** Last-hour summary per tool (`tools` in `GET admin-cockpit/bottleneck`). */
interface ToolSummary {
  tool_name: string;
  calls: number;
  /** 0-1 fraction of failed calls. */
  error_rate: number;
  p95_ms: number;
  /** Most frequent `tool_health.error_type` among the failures, if any were labelled. */
  top_error_type: string | null;
}

interface BottleneckResponse {
  byTool: Record<string, LatencyPoint[]>;
  tools?: ToolSummary[];
}

/** Red above 20% (the `tool_failure_spike` alert threshold), amber for any failure, green for none. */
function errorRateVariant(rate: number): "destructive" | "warning" | "success" {
  if (rate > 0.2) return "destructive";
  return rate > 0 ? "warning" : "success";
}

function ErrorRateBadge({ summary }: { summary: ToolSummary | undefined }) {
  if (!summary) {
    return <span className="text-small text-muted-foreground">No calls in the last hour</span>;
  }
  const pct = (summary.error_rate * 100).toFixed(1);
  return (
    <div className="flex flex-wrap items-center gap-2 text-small text-muted-foreground">
      <Badge variant={errorRateVariant(summary.error_rate)}>{pct}% errors</Badge>
      <span>
        {summary.calls} {summary.calls === 1 ? "call" : "calls"} in the last hour
      </span>
      {summary.top_error_type && summary.error_rate > 0 && (
        <span>
          Top error: <span className="font-mono">{summary.top_error_type}</span>
        </span>
      )}
    </div>
  );
}

export default function BottlenecksPage() {
  const query = useAdminQuery<BottleneckResponse>("bottleneck", [], "admin-cockpit/bottleneck");
  return (
    <div className="space-y-6">
      <PageHeader
        title="Tool latency & error rate"
        description="p50/p95/p99 latency and the last hour's error rate per voice tool, so a slow or failing tool never becomes a customer-visible pause."
      />
      <DataState
        query={query}
        empty={{
          title: "No latency data yet",
          isEmpty: (data) => Object.keys(data?.byTool ?? {}).length === 0,
        }}
        render={(data) => {
          const summaries = new Map((data.tools ?? []).map((t) => [t.tool_name, t]));
          return (
            <div className="space-y-6">
              {Object.entries(data.byTool ?? {}).map(([tool, points]) => (
                <div key={tool} className="rounded-lg border border-border p-4 shadow-xs">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-mono text-small font-medium">{tool}</h2>
                    <ErrorRateBadge summary={summaries.get(tool)} />
                  </div>
                  <LatencyPercentileChart data={points} />
                </div>
              ))}
            </div>
          );
        }}
      />
    </div>
  );
}
