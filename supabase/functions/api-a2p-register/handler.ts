import type { MessagingRegistry } from "../_shared/providers/messaging/registry.ts";
import type {
  SenderRegistration,
  SenderRegistrationApi,
} from "../_shared/providers/messaging/types.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `/api-a2p-register` (API_AND_FLOWS.md A.2, Flow 2 step 6, BACKEND_SPEC
 * §10.1/G4): submits/polls a tenant's carrier registration through the
 * messaging provider's `SenderRegistrationApi` (MESSAGING-1 — no provider
 * field names here) and drives `tenants.a2p_status`
 * (`pending_verification` -> `verified`/`failed`).
 *
 * Which provider: the tenant override (`tenants.sms_provider`) or the
 * platform default. Providers without a registration API (Telnyx today —
 * toll-free verification is submitted in its portal from the owner's
 * `messaging_business_profiles` row, docs/design/MESSAGING_PROVIDERS.md)
 * answer 501 `registration_not_automated`.
 *
 * CARRIER NOTE: the only automated flow (Twilio 10DLC) registers each
 * tenant's campaign against ONE shared platform brand
 * (`TWILIO_A2P_BRAND_SID`). Carriers require ISVs to register every end
 * business as its own brand, so expect TCR to reject this; it is kept
 * unchanged for parity only (docs/BUILD_NOTES.md MESSAGING-1).
 */
export interface A2pRegisterDeps {
  registry: MessagingRegistry;
  /** Brand the registration is filed under (Twilio: TWILIO_A2P_BRAND_SID). */
  brandRef: string | null;
  privacyPolicyUrl: string | null;
  termsAndConditionsUrl: string | null;
  logger: Logger;
}

export type A2pRegisterResult =
  | { ok: true; a2p_status: string; campaign_sid?: string }
  | { ok: false; status: number; error: string };

type A2pStatus = "verified" | "failed" | "pending_verification";

function toA2pStatus(registration: SenderRegistration): A2pStatus {
  if (registration.status === "verified") return "verified";
  if (registration.status === "failed") return "failed";
  return "pending_verification";
}

interface TenantRow {
  name: string;
  vertical: string;
  a2p_status: string;
  a2p_messaging_service_sid: string | null;
  a2p_campaign_sid: string | null;
  sms_provider: string | null;
}

async function refresh(
  sql: SqlClient,
  tenantId: string,
  tenant: TenantRow,
  api: SenderRegistrationApi,
  deps: A2pRegisterDeps,
): Promise<A2pRegisterResult> {
  if (!tenant.a2p_messaging_service_sid || !tenant.a2p_campaign_sid) {
    return { ok: false, status: 422, error: "not_yet_registered" };
  }
  const result = await api.getRegistration({
    profileId: tenant.a2p_messaging_service_sid,
    registrationRef: tenant.a2p_campaign_sid,
  });
  if (!result.ok) {
    deps.logger.error("a2p_register_status_check_failed", {
      tenant_id: tenantId,
      status: result.httpStatus,
    });
    return { ok: false, status: 502, error: "registration_status_check_failed" };
  }
  const mapped = toA2pStatus(result.registration);
  await sql`
    update public.tenants
    set a2p_status = ${mapped},
        a2p_failure_reason = ${mapped === "failed" ? (result.registration.failureReason ?? "rejected") : null}
    where id = ${tenantId}
  `;
  return { ok: true, a2p_status: mapped, campaign_sid: tenant.a2p_campaign_sid };
}

export async function registerA2p(
  sql: SqlClient,
  tenantId: string,
  action: "register" | "refresh" | undefined,
  deps: A2pRegisterDeps,
): Promise<A2pRegisterResult> {
  const tenantRows = await sql<TenantRow>`
    select name, vertical, a2p_status, a2p_messaging_service_sid, a2p_campaign_sid, sms_provider
    from public.tenants where id = ${tenantId} and deleted_at is null
  `;
  const tenant = tenantRows[0];
  if (!tenant) return { ok: false, status: 404, error: "tenant_not_found" };

  if (tenant.a2p_status === "verified") {
    return {
      ok: true,
      a2p_status: "verified",
      ...(tenant.a2p_campaign_sid ? { campaign_sid: tenant.a2p_campaign_sid } : {}),
    };
  }

  const resolution = deps.registry.resolveSms({ tenantOverride: tenant.sms_provider });
  if (!resolution.ok) return { ok: false, status: 503, error: "provider_not_configured" };
  const provider = resolution.provider;
  const api = provider.registration;
  if (!api) return { ok: false, status: 501, error: "registration_not_automated" };

  const resolvedAction = action ?? (tenant.a2p_campaign_sid ? "refresh" : "register");
  if (resolvedAction === "refresh") return refresh(sql, tenantId, tenant, api, deps);

  if (!deps.brandRef || !deps.privacyPolicyUrl || !deps.termsAndConditionsUrl) {
    return { ok: false, status: 503, error: "registration_not_configured" };
  }

  let profileId = tenant.a2p_messaging_service_sid;
  if (!profileId) {
    const created = await api.createMessagingProfile({ friendlyName: `heyloo-${tenantId}` });
    if (!created.ok) {
      deps.logger.error("a2p_register_messaging_service_failed", {
        tenant_id: tenantId,
        status: created.httpStatus,
      });
      await sql`update public.tenants set a2p_status = 'failed', a2p_failure_reason = 'messaging_service_create_failed' where id = ${tenantId}`;
      return { ok: false, status: 502, error: "messaging_service_create_failed" };
    }
    profileId = created.profileId;
    await sql`update public.tenants set a2p_messaging_service_sid = ${profileId} where id = ${tenantId}`;

    // The number must live in THIS provider account. Retell-purchased
    // numbers have no provider id of ours (null, or the
    // `retell-native:<e164>` placeholder api-admin-attach-retell-number
    // writes) and can't be attached — skip them.
    const phoneRows = await sql<{ provider_number_id: string }>`
      select twilio_sid as provider_number_id from public.phone_numbers
      where tenant_id = ${tenantId} and released_at is null
        and twilio_sid is not null and twilio_sid not like 'retell-native:%'
      order by is_primary desc, created_at asc
      limit 1
    `;
    const number = phoneRows[0];
    if (number) {
      const attached = await api.attachNumber({
        profileId,
        providerNumberId: number.provider_number_id,
      });
      if (!attached.ok) {
        deps.logger.warn("a2p_register_attach_number_failed", {
          tenant_id: tenantId,
          status: attached.httpStatus,
        });
      }
    } else {
      deps.logger.warn("a2p_register_no_provider_owned_number", { tenant_id: tenantId });
    }
  }

  const submitted = await api.submitRegistration({
    profileId,
    brandRef: deps.brandRef,
    business: {
      businessName: tenant.name,
      vertical: tenant.vertical,
      privacyPolicyUrl: deps.privacyPolicyUrl,
      termsUrl: deps.termsAndConditionsUrl,
    },
  });
  if (!submitted.ok) {
    deps.logger.error("a2p_register_campaign_create_failed", {
      tenant_id: tenantId,
      status: submitted.httpStatus,
    });
    await sql`update public.tenants set a2p_status = 'failed', a2p_failure_reason = 'campaign_create_failed', a2p_brand_sid = ${deps.brandRef} where id = ${tenantId}`;
    return { ok: false, status: 502, error: "campaign_create_failed" };
  }

  const mapped = toA2pStatus(submitted.registration);
  // `sms_provider` pinned to the provider that holds the registration, so
  // the worker sends this tenant's texts through that same account even if
  // the platform default changes later.
  await sql`
    update public.tenants
    set a2p_brand_sid = ${deps.brandRef}, a2p_campaign_sid = ${submitted.registrationRef},
        a2p_status = ${mapped}, a2p_failure_reason = null,
        sms_provider = coalesce(sms_provider, ${provider.id})
    where id = ${tenantId}
  `;
  return { ok: true, a2p_status: mapped, campaign_sid: submitted.registrationRef };
}
