import { BrandingProvider, Button } from "@heyloo/ui";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { TenantShellClient } from "@/components/tenant/tenant-shell-client";
import { Link } from "@/i18n/navigation";
import { requireTenantSession } from "@/lib/auth/require-tenant-session";
import { TenantRealtimeProvider } from "@/lib/realtime/tenant-realtime-provider";

/**
 * (tenant) root layout — guard #2, the real backstop (FRONTEND_SPEC.md
 * §0.1). Redirect matrix per §0.2, adapted to the real `tenants.status`
 * enum (`trialing|active|past_due|paused|canceled` — not the spec's
 * illustrative `pending_payment/provisioning/suspended`, see
 * docs/BUILD_NOTES.md T5 entry). "paused"/"canceled" render the static
 * notice IN PLACE (never a redirect to a `/dashboard/suspended` sub-route —
 * that sub-route would sit inside this same guarded layout and loop,
 * exactly what §0.2 says never to do).
 */
export default async function TenantLayout({ children }: { children: ReactNode }) {
  const { tenant } = await requireTenantSession("/dashboard");

  if (tenant.status === "trialing") redirect("/signup/plan");

  if (tenant.status === "paused" || tenant.status === "canceled") {
    return (
      <div className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
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

  const branding = (tenant.branding ?? {}) as {
    logo_url?: string;
    primary_color?: string;
    accent_color?: string;
  };

  return (
    <TenantRealtimeProvider tenantId={tenant.id}>
      <div className="heyloo-tenant-branded">
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
        <TenantShellClient
          tenantId={tenant.id}
          tenantName={tenant.name}
          manualMode={tenant.manual_mode}
          manualModeSince={tenant.manual_mode_enabled_at}
        >
          {children}
        </TenantShellClient>
      </div>
    </TenantRealtimeProvider>
  );
}
