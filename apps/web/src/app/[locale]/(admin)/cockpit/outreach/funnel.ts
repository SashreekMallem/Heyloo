/**
 * Split out of `page.tsx` (a Next.js page file may only export a fixed
 * allow-list of names) — same convention as `leads/query.ts`.
 *
 * `GET admin-outreach/funnel` answers `{ leads_by_status: [{status, count}],
 * replies_by_intent, complaint_rate_pct }`. A lead's `status` is its CURRENT
 * stage (mutually exclusive), so a funnel needs the cumulative counts: a lead
 * that has converted was also replied-to, sent and queued.
 */
export interface LeadStatusCount {
  status: string;
  count: number;
}

export interface FunnelStage {
  label: string;
  count: number;
}

const STAGES: { label: string; statuses: readonly string[] }[] = [
  { label: "Sourced", statuses: ["new", "queued", "sent", "replied", "converted", "suppressed"] },
  { label: "In a campaign", statuses: ["queued", "sent", "replied", "converted"] },
  { label: "Contacted", statuses: ["sent", "replied", "converted"] },
  { label: "Replied", statuses: ["replied", "converted"] },
  { label: "Converted", statuses: ["converted"] },
];

/** `[]` when there are no leads at all, so the page shows its empty state instead of an all-zero chart. */
export function buildOutreachFunnel(leadsByStatus: LeadStatusCount[] | undefined): FunnelStage[] {
  const byStatus = new Map((leadsByStatus ?? []).map((row) => [row.status, Number(row.count)]));
  const stages = STAGES.map(({ label, statuses }) => ({
    label,
    count: statuses.reduce((sum, status) => sum + (byStatus.get(status) ?? 0), 0),
  }));
  return stages[0]?.count ? stages : [];
}

/** Blended outreach CAC in cents: total spend / tenants converted, or `null` while nothing has converted (never a fabricated 0). */
export function summarizeCac(
  channels: { total_cost_cents: number; converted_tenant_count: number }[] | undefined,
): number | null {
  const spend = (channels ?? []).reduce((sum, c) => sum + c.total_cost_cents, 0);
  const converted = (channels ?? []).reduce((sum, c) => sum + c.converted_tenant_count, 0);
  return converted > 0 ? Math.round(spend / converted) : null;
}
