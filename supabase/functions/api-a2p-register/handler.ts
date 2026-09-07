import type { TwilioFetch } from "../_shared/providers/twilio.js";
import {
  addPhoneNumberToMessagingService,
  createA2pCampaign,
  createMessagingService,
  getA2pCampaign,
} from "../_shared/providers/twilio.js";
import type { Logger, SqlClient } from "../_shared/types.js";

/**
 * `/api-a2p-register` (API_AND_FLOWS.md A.2 "A2P 10DLC brand + campaign
 * registration", Flow 2 step 6, BACKEND_SPEC §10.1/G4): registers a
 * tenant's Messaging Service + Campaign against the platform's shared ISV
 * brand, driving `tenants.a2p_status` (`pending_verification` ->
 * `verified`/`failed`). Fired non-blocking during provisioning and
 * re-callable to poll/refresh a pending campaign's vetting outcome.
 *
 * The platform BrandRegistration itself is Week-0, one-time, manual setup
 * (Trust Hub profile bundles aren't something this function creates — see
 * `_shared/providers/twilio.ts`'s A2P section docstring) — its SID is
 * configured once via `TWILIO_A2P_BRAND_SID` (already in `.env.example`) and
 * passed in as `deps.platformBrandSid`.
 */
export interface A2pRegisterDeps {
  twilioFetch: TwilioFetch;
  twilioAccountSid: string;
  twilioAuthToken: string;
  platformBrandSid: string;
  privacyPolicyUrl: string;
  termsAndConditionsUrl: string;
  logger: Logger;
}

export type A2pRegisterResult =
  | { ok: true; a2p_status: string; campaign_sid?: string }
  | { ok: false; status: number; error: string };

function mapCampaignStatus(
  twilioStatus: string | undefined,
): "verified" | "failed" | "pending_verification" {
  const normalized = (twilioStatus ?? "").toUpperCase();
  if (["APPROVED", "VERIFIED", "SUCCESS"].includes(normalized)) return "verified";
  if (["FAILED", "DECLINED", "REJECTED"].includes(normalized)) return "failed";
  return "pending_verification";
}

async function refreshCampaignStatus(
  sql: SqlClient,
  tenantId: string,
  messagingServiceSid: string,
  campaignSid: string,
  deps: A2pRegisterDeps,
): Promise<A2pRegisterResult> {
  const result = await getA2pCampaign(
    deps.twilioFetch,
    deps.twilioAccountSid,
    deps.twilioAuthToken,
    messagingServiceSid,
    campaignSid,
  );
  if (!result.ok) {
    deps.logger.error("a2p_register_status_check_failed", {
      tenant_id: tenantId,
      status: result.status,
    });
    return { ok: false, status: 502, error: "twilio_status_check_failed" };
  }
  const body = result.body as { campaignStatus?: string; failureReason?: string };
  const mapped = mapCampaignStatus(body.campaignStatus);
  await sql`
    update public.tenants
    set a2p_status = ${mapped}, a2p_failure_reason = ${mapped === "failed" ? (body.failureReason ?? "rejected") : null}
    where id = ${tenantId}
  `;
  return { ok: true, a2p_status: mapped, campaign_sid: campaignSid };
}

export async function registerA2p(
  sql: SqlClient,
  tenantId: string,
  action: "register" | "refresh" | undefined,
  deps: A2pRegisterDeps,
): Promise<A2pRegisterResult> {
  const tenantRows = await sql<{
    name: string;
    vertical: string;
    a2p_status: string;
    a2p_messaging_service_sid: string | null;
    a2p_campaign_sid: string | null;
  }>`
    select name, vertical, a2p_status, a2p_messaging_service_sid, a2p_campaign_sid
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

  const resolvedAction = action ?? (tenant.a2p_campaign_sid ? "refresh" : "register");

  if (resolvedAction === "refresh") {
    if (!tenant.a2p_messaging_service_sid || !tenant.a2p_campaign_sid) {
      return { ok: false, status: 422, error: "not_yet_registered" };
    }
    return refreshCampaignStatus(
      sql,
      tenantId,
      tenant.a2p_messaging_service_sid,
      tenant.a2p_campaign_sid,
      deps,
    );
  }

  // resolvedAction === "register"
  let messagingServiceSid = tenant.a2p_messaging_service_sid;
  if (!messagingServiceSid) {
    const serviceResult = await createMessagingService(
      deps.twilioFetch,
      deps.twilioAccountSid,
      deps.twilioAuthToken,
      `heyloo-${tenantId}`,
    );
    const serviceBody = serviceResult.body as { sid?: string };
    if (!serviceResult.ok || !serviceBody.sid) {
      deps.logger.error("a2p_register_messaging_service_failed", {
        tenant_id: tenantId,
        status: serviceResult.status,
      });
      await sql`update public.tenants set a2p_status = 'failed', a2p_failure_reason = 'messaging_service_create_failed' where id = ${tenantId}`;
      return { ok: false, status: 502, error: "messaging_service_create_failed" };
    }
    messagingServiceSid = serviceBody.sid;
    await sql`update public.tenants set a2p_messaging_service_sid = ${messagingServiceSid} where id = ${tenantId}`;

    const phoneRows = await sql<{ twilio_sid: string }>`
      select twilio_sid from public.phone_numbers
      where tenant_id = ${tenantId} and released_at is null
      order by is_primary desc, created_at asc
      limit 1
    `;
    const phoneNumber = phoneRows[0];
    if (phoneNumber) {
      await addPhoneNumberToMessagingService(
        deps.twilioFetch,
        deps.twilioAccountSid,
        deps.twilioAuthToken,
        messagingServiceSid,
        phoneNumber.twilio_sid,
      );
    } else {
      deps.logger.warn("a2p_register_no_phone_number_yet", { tenant_id: tenantId });
    }
  }

  const campaignResult = await createA2pCampaign(
    deps.twilioFetch,
    deps.twilioAccountSid,
    deps.twilioAuthToken,
    messagingServiceSid,
    {
      brandRegistrationSid: deps.platformBrandSid,
      description: `Automated phone answering and appointment booking for ${tenant.name}, a ${tenant.vertical.replace("_", " ")} business.`,
      messageFlow:
        "Customers speak with our AI phone assistant and give verbal consent during the call before receiving any SMS booking confirmation, reminder, or reply.",
      usAppToPersonUsecase: "CUSTOMER_CARE",
      hasEmbeddedLinks: true,
      hasEmbeddedPhone: true,
      privacyPolicyUrl: deps.privacyPolicyUrl,
      termsAndConditionsUrl: deps.termsAndConditionsUrl,
      sampleMessages: [
        "You're confirmed for Tue 2:00 PM at Joe's Auto. Reply STOP to opt out.",
        "A slot opened up for your requested time — reply YES to book it.",
      ],
    },
  );
  const campaignBody = campaignResult.body as { sid?: string; campaignStatus?: string };
  if (!campaignResult.ok || !campaignBody.sid) {
    deps.logger.error("a2p_register_campaign_create_failed", {
      tenant_id: tenantId,
      status: campaignResult.status,
    });
    await sql`update public.tenants set a2p_status = 'failed', a2p_failure_reason = 'campaign_create_failed', a2p_brand_sid = ${deps.platformBrandSid} where id = ${tenantId}`;
    return { ok: false, status: 502, error: "campaign_create_failed" };
  }

  const mapped = mapCampaignStatus(campaignBody.campaignStatus);
  await sql`
    update public.tenants
    set a2p_brand_sid = ${deps.platformBrandSid}, a2p_campaign_sid = ${campaignBody.sid},
        a2p_status = ${mapped}, a2p_failure_reason = null
    where id = ${tenantId}
  `;
  return { ok: true, a2p_status: mapped, campaign_sid: campaignBody.sid };
}
