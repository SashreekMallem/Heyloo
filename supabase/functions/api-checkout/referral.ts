import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * Referral attribution at signup (PT-01). The web app forwards the partner
 * code from its first-party `heyloo_ref` cookie as `referral_code`; this
 * resolves it and records who referred the tenant:
 *
 *   - `tenants.referrer_partner_id` / `referral_link_id`, and
 *   - one `pending` `referrals` row (unique per `referred_tenant_id`),
 *
 * which `fn_check_referral_qualification` later promotes to `qualified` once
 * the tenant pays its 2nd month (it only updates existing rows, so nothing
 * earns without this write).
 *
 * The code is only a CLAIM from the browser. Everything that matters is
 * resolved here with the verified user id (`sub` of the JWT): an unknown code
 * is ignored, a partner referring their own account is refused, and an
 * already-attributed tenant is never re-attributed (first attribution wins,
 * which also makes a retried checkout idempotent). The update and the insert
 * are ONE statement, so a tenant can never carry a referrer without its
 * `referrals` row (or the reverse).
 *
 * Never throws: attribution must not be able to break checkout.
 */
export type ReferralAttributionResult =
  | "attributed"
  | "no_code"
  | "unknown_code"
  | "self_referral"
  | "already_attributed"
  | "error";

/** Same shape the web app validates: 4-32 letters/digits, stored upper-case. */
export function normalizeReferralCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z0-9]{4,32}$/.test(code) ? code : null;
}

interface LinkRow {
  link_id: string;
  referral_partner_id: string;
  partner_user_id: string | null;
}

export async function attributeReferral(
  sql: SqlClient,
  params: { tenantId: string; userId: string; referralCode: string | undefined },
  logger: Logger,
): Promise<ReferralAttributionResult> {
  const code = normalizeReferralCode(params.referralCode);
  if (!code) return "no_code";

  try {
    const links = await sql<LinkRow>`
      select l.id as link_id, l.referral_partner_id, p.user_id as partner_user_id
      from public.referral_links l
      join public.referral_partners p on p.id = l.referral_partner_id
      where l.code = ${code}
      limit 1
    `;
    const link = links[0];
    if (!link) return "unknown_code";

    if (link.partner_user_id && link.partner_user_id === params.userId) {
      logger.warn("api_checkout_referral_self_referral", { tenant_id: params.tenantId });
      return "self_referral";
    }

    const inserted = await sql<{ id: string }>`
      with attributed as (
        update public.tenants
        set referrer_partner_id = ${link.referral_partner_id},
            referral_link_id = ${link.link_id}
        where id = ${params.tenantId} and referrer_partner_id is null
        returning id
      )
      insert into public.referrals
        (referral_link_id, referral_partner_id, referred_tenant_id, attribution_source)
      select ${link.link_id}, ${link.referral_partner_id}, attributed.id, 'cookie'
      from attributed
      on conflict (referred_tenant_id) do nothing
      returning id
    `;
    return inserted.length > 0 ? "attributed" : "already_attributed";
  } catch (error) {
    logger.error("api_checkout_referral_attribution_failed", {
      tenant_id: params.tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return "error";
  }
}
