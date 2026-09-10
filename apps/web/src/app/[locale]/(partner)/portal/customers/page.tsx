import { formatCentsUSD } from "@heyloo/canonical-types";
import { Badge, type BadgeProps, Card, CardContent, PageHeader } from "@heyloo/ui";
import type { Metadata } from "next";
import { requirePartnerSession } from "@/lib/auth/require-partner-session";
import { createSupabaseServiceRoleServerClient } from "@/lib/supabase/service-role";

export const metadata: Metadata = { title: "Your customers — Heyloo" };

interface CommissionRow {
  id: string;
  referral_id: string;
  period: string | null;
  base_cents: number | null;
  rate_bps: number | null;
  amount_cents: number;
  status: string;
}

/**
 * Partner portal per-customer monthly breakdown (Cluster H task brief item
 * 4). `commission_events`/`referrals` are read through the partner's own
 * RLS-bound session (both tables already scope `select` to
 * `fn_jwt_referral_partner_id()`) — only the referred tenant's display
 * name needs service role, since `tenants` RLS has no partner-visibility
 * policy at all; that lookup is explicitly filtered to the tenant ids this
 * partner's own already-RLS-scoped `referrals` rows named, never an
 * unscoped read (CLAUDE.md Rule 2's "every secret-key function must still
 * explicitly filter by a verified id" — here, a verified partner_id).
 * "Costs" are deliberately NOT shown (BACKEND_SPEC §5 margin secrecy is
 * admin-cockpit-only) — "base" already reflects a partner's own
 * `commission_base` (gross profit net of cost, or revenue) per the terms
 * an admin set for them.
 */
function formatCommissionPeriod(period: string | null): string {
  if (!period) return "One-time bonus";
  const date = new Date(period);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short" });
}

const REFERRAL_STATUS_VARIANT: Record<string, BadgeProps["variant"]> = {
  pending: "outline",
  qualified: "success",
  paid: "success",
  clawed_back: "destructive",
  disqualified: "destructive",
};

export default async function PartnerCustomersPage() {
  const { supabase, partner } = await requirePartnerSession("/portal/customers");

  const { data: referrals } = await supabase
    .from("referrals")
    .select("id, referred_tenant_id, status, qualified_at, amount_cents_snapshot")
    .eq("referral_partner_id", partner.id)
    .order("qualified_at", { ascending: false, nullsFirst: false });

  const tenantIds = [...new Set((referrals ?? []).map((r) => r.referred_tenant_id))];
  const serviceSupabase = createSupabaseServiceRoleServerClient();
  const { data: tenants } =
    tenantIds.length > 0
      ? await serviceSupabase.from("tenants").select("id, name, vertical").in("id", tenantIds)
      : { data: [] as { id: string; name: string; vertical: string }[] };
  const tenantById = new Map((tenants ?? []).map((t) => [t.id, t]));

  // `commission_events` postdates @heyloo/supabase-client's hand-maintained
  // Database type (added by 20260910140000_referral_commission_recurring.sql)
  // — cast `.from` to accept it, per the established workaround for tables
  // this package hasn't caught up to yet (docs/audit/FIX_REQUESTS.md).
  // biome-ignore lint/suspicious/noExplicitAny: see comment above.
  const fromUntyped = supabase.from.bind(supabase) as (table: string) => any;
  const { data: commissionRows } = await fromUntyped("commission_events")
    .select("id, referral_id, period, base_cents, rate_bps, amount_cents, status")
    .eq("referral_partner_id", partner.id)
    .order("period", { ascending: false, nullsFirst: true });

  const commissionsByReferral = new Map<string, CommissionRow[]>();
  for (const row of (commissionRows ?? []) as unknown as CommissionRow[]) {
    const list = commissionsByReferral.get(row.referral_id) ?? [];
    list.push(row);
    commissionsByReferral.set(row.referral_id, list);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Your customers"
        description="Every business you've referred, and what each one has earned you."
      />
      {(referrals ?? []).length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No referred customers yet — share your link from the dashboard to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {(referrals ?? []).map((referral) => {
            const tenant = tenantById.get(referral.referred_tenant_id);
            const commissions = commissionsByReferral.get(referral.id) ?? [];
            return (
              <Card key={referral.id}>
                <CardContent className="space-y-3 pt-6">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{tenant?.name ?? "Customer"}</p>
                      {tenant?.vertical && (
                        <p className="text-xs capitalize text-muted-foreground">
                          {tenant.vertical}
                        </p>
                      )}
                    </div>
                    <Badge
                      variant={REFERRAL_STATUS_VARIANT[referral.status] ?? "outline"}
                      className="capitalize"
                    >
                      {referral.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  {commissions.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No commission activity yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-muted-foreground">
                            <th className="pb-1 pr-4 font-normal">Period</th>
                            <th className="pb-1 pr-4 font-normal">Base</th>
                            <th className="pb-1 pr-4 font-normal">Rate</th>
                            <th className="pb-1 pr-4 font-normal">Your share</th>
                            <th className="pb-1 font-normal">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {commissions.map((c) => (
                            <tr key={c.id} className="border-t border-border">
                              <td className="py-1.5 pr-4">{formatCommissionPeriod(c.period)}</td>
                              <td className="py-1.5 pr-4 tabular-nums">
                                {c.base_cents != null ? formatCentsUSD(c.base_cents) : "—"}
                              </td>
                              <td className="py-1.5 pr-4 tabular-nums">
                                {c.rate_bps != null && Number.isFinite(c.rate_bps)
                                  ? `${(c.rate_bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`
                                  : "—"}
                              </td>
                              <td className="py-1.5 pr-4 font-medium tabular-nums">
                                {formatCentsUSD(c.amount_cents)}
                              </td>
                              <td className="py-1.5 capitalize">{c.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
