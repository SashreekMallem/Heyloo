"use client";

import { Callout, type ProvisioningStep, ProvisioningTimeline } from "@heyloo/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { TenantRealtimeProvider } from "@/lib/realtime/tenant-realtime-provider";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

// Matches `supabase/functions/api-provision/handler.ts`'s `STEPS` exactly
// (SIGNUP-1: the number purchase is now a single Retell-native step, not a
// separate Twilio-purchase + Retell-import pair — docs/BUILD_NOTES.md
// SIGNUP-1 entry).
// `tenant_finalize`'s label depends on the free trial (`finalizeLabel`).
const STEP_ORDER: { key: string; label: string }[] = [
  { key: "tenant_finalize", label: "Card added" },
  { key: "agent_compile", label: "AI agent compiled" },
  { key: "retell_number_provision", label: "Phone number provisioned" },
  { key: "billing_wiring", label: "Billing connected" },
  { key: "publish_agent", label: "Ready" },
];

interface RunRow {
  step: string;
  status: "pending" | "in_progress" | "succeeded" | "failed";
}

interface ProvisioningPoll {
  runs: RunRow[];
  /** `tenants.trial_ends_at` is set; null = not known (the read failed). */
  trialStarted: boolean | null;
}

function useProvisioningRuns(tenantId: string) {
  return useQuery({
    queryKey: ["tenant", tenantId, "provisioning_runs"],
    queryFn: async ({ client, queryKey }): Promise<ProvisioningPoll> => {
      const { data } = await supabaseBrowserClient
        .from("provisioning_runs")
        .select("step, status")
        .eq("tenant_id", tenantId);
      // TRIAL-1: read AFTER the runs. webhooks-stripe stores a trial
      // Checkout's `trial_ends_at` before it starts provisioning, so when this
      // poll sees `tenant_finalize` succeeded, the trial is visible here too.
      const { data: tenant, error } = await supabaseBrowserClient
        .from("tenants")
        .select("trial_ends_at")
        .eq("id", tenantId)
        .maybeSingle();
      // A failed read says nothing about the trial: keep what the last poll
      // knew (`trial_ends_at` is never cleared once set), else unknown —
      // never "no trial", which would show "Payment confirmed".
      const trialStarted = error
        ? (client.getQueryData<ProvisioningPoll>(queryKey)?.trialStarted ?? null)
        : tenant?.trial_ends_at != null;
      return { runs: (data ?? []) as RunRow[], trialStarted };
    },
    refetchInterval: 2500,
  });
}

/**
 * With the free trial nothing is charged at signup, so "Payment confirmed"
 * would be untrue. A business that already had its one trial pays at signup:
 * the step succeeded with no trial recorded. Until either is known (or when
 * the trial read failed), the neutral STEP_ORDER label.
 */
function finalizeLabel(trialStarted: boolean | null, finalized: boolean): string | null {
  if (trialStarted === true) return "Card added — trial started";
  if (trialStarted === false && finalized) return "Payment confirmed";
  return null;
}

function Inner({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const { data } = useProvisioningRuns(tenantId);
  const runs = data?.runs;
  const [startedAt] = useState(() => Date.now());
  const [timedOut, setTimedOut] = useState(false);

  const steps: ProvisioningStep[] = STEP_ORDER.map(({ key, label }) => {
    const status = runs?.find((r) => r.step === key)?.status ?? "pending";
    const shown =
      key === "tenant_finalize"
        ? (finalizeLabel(data?.trialStarted ?? null, status === "succeeded") ?? label)
        : label;
    return { key, label: shown, status };
  });

  const failed = steps.find((s) => s.status === "failed");
  const allSucceeded = steps.every((s) => s.status === "succeeded");

  useEffect(() => {
    if (allSucceeded) {
      // The tenant is active and the line is live: the signup draft cookie has
      // done its job (it was kept through checkout so a cancel could resume).
      void fetch("/api/signup/draft", { method: "DELETE" }).catch(() => undefined);
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
