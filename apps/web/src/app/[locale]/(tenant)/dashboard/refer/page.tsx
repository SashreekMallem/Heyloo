"use client";

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataState,
  FunnelChart,
} from "@heyloo/ui";
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
      <h1 className="text-xl font-semibold">Refer & earn</h1>
      <DataState
        query={query}
        empty={{ title: "Generating your referral link…" }}
        render={(data) => (
          <>
            {data.approaching_w9_threshold && (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                You&apos;re approaching the $600 1099 reporting threshold — complete a W-9 to keep
                payouts on track.
              </div>
            )}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Your referral link</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
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
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Earn a referral bonus after a business you refer completes their 2nd paid month.
                </p>
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
