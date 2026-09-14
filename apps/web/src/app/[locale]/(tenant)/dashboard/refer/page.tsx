"use client";

import {
  Button,
  Callout,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataState,
  PageHeader,
} from "@heyloo/ui";
import { FunnelChart } from "@heyloo/ui/charts";
import { useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

interface ReferralFunnel {
  code: string | null;
  funnel: { signups: number; qualified: number; paid: number };
  approaching_w9_threshold: boolean;
}

export default function ReferPage() {
  const tenantId = useCurrentTenantId();

  const query = useQuery({
    queryKey: ["tenant", tenantId, "referral_links"],
    queryFn: async (): Promise<ReferralFunnel> => {
      const res = await fetch("/api/tenant/refer/ensure-link", { method: "POST" });
      const body = (await res.json()) as {
        code?: string;
        funnel?: { signups: number; qualified: number; paid: number };
        approaching_w9_threshold?: boolean;
      };
      return {
        code: body.code ?? null,
        funnel: body.funnel ?? { signups: 0, qualified: 0, paid: 0 },
        approaching_w9_threshold: body.approaching_w9_threshold ?? false,
      };
    },
    enabled: !!tenantId,
  });

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const link = query.data?.code ? `${origin}/signup?ref=${query.data.code}` : "";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Refer & earn"
        description="Share your link — earn a bonus when a business you refer stays on for their 2nd paid month."
      />
      <DataState
        query={query}
        empty={{ title: "Generating your referral link…" }}
        render={(data) => (
          <>
            {data.approaching_w9_threshold && (
              <Callout tone="warning" title="W-9 needed soon">
                You&apos;re approaching the $600 1099 reporting threshold — complete a W-9 to keep
                payouts on track.
              </Callout>
            )}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Your referral link</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {link ? (
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                      {link}
                    </code>
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard?.writeText(link);
                        toast.success("Link copied");
                      }}
                      aria-label="Copy referral link"
                    >
                      <Copy className="size-4" />
                    </Button>
                  </div>
                ) : (
                  // A real placeholder, never a blank input — link generation
                  // failed or hasn't finished; refetch is the recovery path.
                  <div className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                    We couldn&apos;t generate your link just yet.{" "}
                    <button
                      type="button"
                      className="font-medium text-foreground underline"
                      onClick={() => void query.refetch()}
                    >
                      Try again
                    </button>
                  </div>
                )}
                <p className="text-sm text-muted-foreground">
                  Earn a referral bonus after a business you refer completes their 2nd paid month.
                </p>
                {/* Explicit numeric labels alongside the chart — the bar chart
                   alone can look blank at all-zero values, so the funnel
                   tiles must always show a real number. */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(
                    [
                      { label: "Clicks", count: 0 },
                      { label: "Signups", count: data.funnel.signups },
                      { label: "Qualified", count: data.funnel.qualified },
                      { label: "Paid", count: data.funnel.paid },
                    ] as const
                  ).map((stage) => (
                    <div
                      key={stage.label}
                      className="rounded-lg border border-border px-3 py-2 text-center"
                    >
                      <p className="text-lg font-semibold tabular-nums">{stage.count}</p>
                      <p className="text-xs text-muted-foreground">{stage.label}</p>
                    </div>
                  ))}
                </div>
                <FunnelChart
                  stages={[
                    { label: "Clicks", count: 0 },
                    { label: "Signups", count: data.funnel.signups },
                    { label: "Qualified", count: data.funnel.qualified },
                    { label: "Paid", count: data.funnel.paid },
                  ]}
                />
              </CardContent>
            </Card>
          </>
        )}
      />
    </div>
  );
}
