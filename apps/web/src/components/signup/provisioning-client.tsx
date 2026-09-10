"use client";

import { Callout, type ProvisioningStep, ProvisioningTimeline } from "@heyloo/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { TenantRealtimeProvider } from "@/lib/realtime/tenant-realtime-provider";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

const STEP_ORDER: { key: string; label: string }[] = [
  { key: "tenant_finalize", label: "Payment confirmed" },
  { key: "agent_compile", label: "AI agent compiled" },
  { key: "twilio_number_provision", label: "Phone number provisioned" },
  { key: "retell_number_import", label: "Voice provider import" },
  { key: "billing_wiring", label: "Billing meter created" },
  { key: "publish_agent", label: "Ready" },
];

interface RunRow {
  step: string;
  status: "pending" | "in_progress" | "succeeded" | "failed";
}

function useProvisioningRuns(tenantId: string) {
  return useQuery({
    queryKey: ["tenant", tenantId, "provisioning_runs"],
    queryFn: async () => {
      const { data } = await supabaseBrowserClient
        .from("provisioning_runs")
        .select("step, status")
        .eq("tenant_id", tenantId);
      return (data ?? []) as RunRow[];
    },
    refetchInterval: 2500,
  });
}

function Inner({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const { data: runs } = useProvisioningRuns(tenantId);
  const [startedAt] = useState(() => Date.now());
  const [timedOut, setTimedOut] = useState(false);

  const steps: ProvisioningStep[] = STEP_ORDER.map(({ key, label }) => {
    const run = runs?.find((r) => r.step === key);
    return { key, label, status: run?.status ?? "pending" };
  });

  const failed = steps.find((s) => s.status === "failed");
  const allSucceeded = steps.every((s) => s.status === "succeeded");

  useEffect(() => {
    if (allSucceeded) {
      const timer = setTimeout(() => router.push("/signup/forwarding"), 1500);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [allSucceeded, router]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (Date.now() - startedAt > 90_000) setTimedOut(true);
    }, 5000);
    return () => clearInterval(timer);
  }, [startedAt]);

  return (
    <div className="mx-auto max-w-md space-y-8">
      <div className="space-y-1.5 text-center">
        <h1 className="font-display text-h2 font-semibold">Setting up your AI receptionist</h1>
        <p className="text-small text-muted-foreground">This usually takes under a minute.</p>
      </div>
      <ProvisioningTimeline steps={steps} />
      {allSucceeded && (
        <p className="text-center text-small font-medium text-success">
          You&apos;re live! Taking you to phone setup…
        </p>
      )}
      {failed && (
        <Callout tone="danger" title={`We hit a snag on "${failed.label}"`}>
          We&apos;re on it. Contact support if this doesn&apos;t clear in a few minutes.
        </Callout>
      )}
      {!allSucceeded && !failed && timedOut && (
        <p className="text-center text-small text-muted-foreground">
          Still working — we&apos;ll email you the moment it&apos;s ready. Feel free to close this
          tab.
        </p>
      )}
    </div>
  );
}

export function ProvisioningClient({ tenantId }: { tenantId: string }) {
  return (
    <TenantRealtimeProvider tenantId={tenantId}>
      <Inner tenantId={tenantId} />
    </TenantRealtimeProvider>
  );
}
