/** $600 — the standard US 1099-NEC reporting threshold (FRONTEND_SPEC.md §7). */
export const W9_THRESHOLD_CENTS = 60000;

export interface ReferralFunnelCounts {
  signups: number;
  qualified: number;
  paid: number;
}

/** Real funnel counts from `referrals` rows — never a fabricated constant (FRONTEND_AUDIT.md H7). */
export function computeReferralFunnel(rows: { status: string }[]): ReferralFunnelCounts {
  return {
    signups: rows.length,
    qualified: rows.filter((r) => r.status === "qualified" || r.status === "paid").length,
    paid: rows.filter((r) => r.status === "paid").length,
  };
}

/**
 * "Approaching" mirrors this app's own 80%-of-threshold convention (the
 * usage-alert `warn_pct` in `platform_settings.usage_alert_thresholds`) —
 * never once a W-9 is already verified.
 */
export function isApproachingW9Threshold(
  ytdPayoutCents: number,
  w9Status: string,
  thresholdCents = W9_THRESHOLD_CENTS,
): boolean {
  return w9Status !== "verified" && ytdPayoutCents >= thresholdCents * 0.8;
}
