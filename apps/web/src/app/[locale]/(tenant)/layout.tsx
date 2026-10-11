import { BrandingProvider } from "@heyloo/ui/layout/branding-provider";
import { Button } from "@heyloo/ui/primitives/button";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { TenantShellClient } from "@/components/tenant/tenant-shell-client";
import { Link } from "@/i18n/navigation";
import { requireTenantSession } from "@/lib/auth/require-tenant-session";
import { SentryInit } from "@/lib/perf/sentry-init";
import { TenantRealtimeProvider } from "@/lib/realtime/tenant-realtime-provider";

type TenantSession = Awaited<ReturnType<typeof requireTenantSession>>;

const DAY_MS = 86_400_000;

interface FreeTrialBanner {
  daysLeft: number;
  minutesUsed: number;
  minutesCap: number | null;
  /** The owner canceled: the subscription ends with the trial, unpaid. */
  cancelScheduled: boolean;
}

/**
 * TRIAL-1 banner data, or null unless the free trial is running. Trial
 * minutes are billable usage before `trial_ends_at`, the same rule the
 * minutes cap and job-billing-cycle use (supabase/functions/_shared/trial/
 * cap.ts). Only queried during a trial; at most a few hundred rows.
 */
async function loadFreeTrialBanner(
  supabase: TenantSession["supabase"],
  tenant: TenantSession["tenant"],
  now: Date,
): Promise<FreeTrialBanner | null> {
  if (!tenant.trial_ends_at || tenant.trial_ended_reason) return null;
  const endsAt = Date.parse(tenant.trial_ends_at);
  if (!Number.isFinite(endsAt) || endsAt <= now.getTime()) return null;
  const { data } = await supabase
    .from("usage_events")
    .select("minutes")
    .eq("tenant_id", tenant.id)
    .eq("is_billable", true)
    .lt("occurred_at", tenant.trial_ends_at);
  const used = (data ?? []).reduce((sum, row) => sum + (Number(row.minutes) || 0), 0);
  return {
    daysLeft: Math.max(1, Math.ceil((endsAt - now.getTime()) / DAY_MS)),
    minutesUsed: Math.floor(used),
    minutesCap: tenant.trial_minutes_cap,
    cancelScheduled: tenant.trial_cancel_scheduled === true,
  };
}

function freeTrialBannerText(trial: FreeTrialBanner): string {
  const days = `${trial.daysLeft} ${trial.daysLeft === 1 ? "day" : "days"} left`;
  const usage = trial.minutesCap
    ? ` · ${Math.min(trial.minutesUsed, trial.minutesCap)} of ${trial.minutesCap} minutes used`
    : "";
  if (trial.cancelScheduled) {
    return `Free trial — ${days}${usage}. You canceled, so your subscription ends with the trial and you won't be charged.`;
  }
  if (!trial.minutesCap) return `Free trial — ${days}. Your plan starts when the trial ends.`;
  return `Free trial — ${days}${usage}. Your plan starts when either runs out.`;
}

/**
 * (tenant) root layout — guard #2, the real backstop (FRONTEND_SPEC.md
 * §0.1). Redirect matrix per §0.2, adapted to the real `tenants.status`
 * enum (`trialing|active|past_due|paused|canceled` — not the spec's
 * illustrative `pending_payment/provisioning/suspended`, see
 * docs/BUILD_NOTES.md T5 entry). "paused"/"canceled" render the static
 * notice IN PLACE (never a redirect to a `/dashboard/suspended` sub-route —
 * that sub-route would sit inside this same guarded layout and loop,
 * exactly what §0.2 says never to do). Mounts `<SentryInit>` (see that
 * file's docstring) in both branches — error monitoring is route-group-
 * scoped, never reachable from the marketing bundle.
 */
export default async function TenantLayout({ children }: { children: ReactNode }) {
  const { tenant, claims, supabase } = await requireTenantSession("/dashboard");

  if (tenant.status === "trialing") redirect("/signup/plan");

  if (tenant.status === "paused" || tenant.status === "canceled") {
    return (
      <div className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <SentryInit />
        <h1 className="font-display text-h3 font-semibold">Your account is paused</h1>
        <p className="text-body text-muted-foreground">
          {tenant.status === "canceled"
            ? "Your subscription has been canceled. Contact support if you'd like to reactivate."
            : "Your account has been paused. Contact support for details or to resume service."}
        </p>
        <Button asChild>
          <a href="mailto:support@heyloo.com">Contact support</a>
        </Button>
      </div>
    );
  }

  const trial = await loadFreeTrialBanner(supabase, tenant, new Date());

  const branding = (tenant.branding ?? {}) as {
    logo_url?: string;
    primary_color?: string;
    accent_color?: string;
  };

  return (
    <TenantRealtimeProvider tenantId={tenant.id}>
      <div className="heyloo-tenant-branded">
        <SentryInit />
        <BrandingProvider
          branding={{
            logoUrl: branding.logo_url,
            primary: branding.primary_color,
            accent: branding.accent_color,
          }}
        />
        {tenant.status === "past_due" && (
          <div className="border-b border-warning/40 bg-warning/10 px-4 py-2 text-center text-sm text-warning">
            Your last payment failed — please update your billing details to avoid interruption.{" "}
            <Link href="/dashboard/billing" className="underline">
              Update billing
            </Link>
          </div>
        )}
        {trial && (
          <div
            className="border-b border-primary/30 bg-primary/5 px-4 py-2 text-center text-sm"
            data-testid="free-trial-banner"
          >
            {freeTrialBannerText(trial)}{" "}
            <Link href="/dashboard/billing" className="underline">
              Billing
            </Link>
          </div>
        )}
        <TenantShellClient
          tenantId={tenant.id}
          tenantName={tenant.name}
          manualMode={tenant.manual_mode}
          manualModeSince={tenant.manual_mode_enabled_at}
          canWrite={
            claims.role === "owner" || claims.role === "admin" || claims.platform_admin === true
          }
          isOwner={claims.role === "owner"}
        >
          {children}
        </TenantShellClient>
      </div>
    </TenantRealtimeProvider>
  );
}
