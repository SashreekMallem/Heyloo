/** Pure helpers for the partner referral link and earnings figures (PT-06). */

/** The absolute referral URL a partner shares. */
export function buildReferralLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/signup?ref=${encodeURIComponent(code)}`;
}

/**
 * The public origin the current request came in on. Behind Vercel's proxy the
 * `x-forwarded-*` headers carry it; `fallback` (the configured app URL) is
 * used when no host header is present at all.
 */
export function requestOrigin(headers: Pick<Headers, "get">, fallback: string): string {
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) return fallback;
  const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = forwardedProto || (isLocal ? "http" : "https");
  return `${proto}://${host}`;
}

export interface CommissionAmountRow {
  amount_cents: number;
  status: string;
}

export interface PartnerEarnings {
  /** Commission already paid out to the partner (`commission_events.status = 'paid'`). */
  paidCents: number;
  /** Earned but not yet paid: `accrued` (waiting for the monthly run) or `batched` (in a payout in flight). */
  pendingCents: number;
}

/** `clawed_back` commissions count for neither figure. Integer cents throughout. */
export function summarizeEarnings(rows: CommissionAmountRow[]): PartnerEarnings {
  let paidCents = 0;
  let pendingCents = 0;
  for (const row of rows) {
    if (row.status === "paid") paidCents += row.amount_cents;
    else if (row.status === "accrued" || row.status === "batched") pendingCents += row.amount_cents;
  }
  return { paidCents, pendingCents };
}
