/**
 * Minimal Twilio REST client via plain `fetch` + Basic auth (accountSid:
 * authToken) — same rationale as providers/retell.ts (portable, no SDK,
 * outside the packages/adapters Node-only boundary by necessity of the Deno
 * runtime). VERIFY (docs/VERIFY.md): endpoint shapes are the long-stable
 * Twilio 2010-04-01 REST API (egress-blocked in this build; confirm before
 * first live send/purchase).
 */

const TWILIO_BASE_URL = "https://api.twilio.com/2010-04-01";

export type TwilioFetch = (input: string, init?: RequestInit) => Promise<Response>;

function basicAuthHeader(accountSid: string, authToken: string): string {
  return `Basic ${btoa(`${accountSid}:${authToken}`)}`;
}

async function twilioRequest(
  fetchImpl: TwilioFetch,
  accountSid: string,
  authToken: string,
  path: string,
  params: Record<string, string>,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetchImpl(`${TWILIO_BASE_URL}/Accounts/${accountSid}${path}`, {
    method: "POST",
    headers: {
      authorization: basicAuthHeader(accountSid, authToken),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  const body = await res.json().catch(() => undefined);
  return { ok: res.ok, status: res.status, body };
}

export async function sendSms(
  fetchImpl: TwilioFetch,
  accountSid: string,
  authToken: string,
  params: { to: string; from: string; body: string },
) {
  return twilioRequest(fetchImpl, accountSid, authToken, "/Messages.json", {
    To: params.to,
    From: params.from,
    Body: params.body,
  });
}

export async function purchasePhoneNumber(
  fetchImpl: TwilioFetch,
  accountSid: string,
  authToken: string,
  params: { phoneNumber: string; voiceUrl?: string; friendlyName?: string },
) {
  return twilioRequest(fetchImpl, accountSid, authToken, "/IncomingPhoneNumbers.json", {
    PhoneNumber: params.phoneNumber,
    ...(params.voiceUrl ? { VoiceUrl: params.voiceUrl } : {}),
    ...(params.friendlyName ? { FriendlyName: params.friendlyName } : {}),
  });
}

/** Updates an existing Twilio number's voice webhook — used by the
 * Retell-health-failover job (BACKEND_SPEC §8, G5) to flip routing away
 * from Retell during an outage, and back once recovered. */
export async function updateIncomingPhoneNumberVoiceUrl(
  fetchImpl: TwilioFetch,
  accountSid: string,
  authToken: string,
  twilioSid: string,
  voiceUrl: string,
) {
  return twilioRequest(
    fetchImpl,
    accountSid,
    authToken,
    `/IncomingPhoneNumbers/${twilioSid}.json`,
    {
      VoiceUrl: voiceUrl,
    },
  );
}

// ---------------------------------------------------------------------
// A2P 10DLC (API_AND_FLOWS.md A.2 "A2P 10DLC brand + campaign registration
// (reseller/ISV flow)") — a DIFFERENT base host (`messaging.twilio.com`,
// not `api.twilio.com/2010-04-01`) from every other function in this file;
// still HTTP Basic (Account SID / Auth Token). VERIFY.md: exact required
// fields per Twilio's current ISV walkthrough are egress-blocked here;
// confirmed via indexed search (docs/BUILD_NOTES.md T4 entry) that
// BrandRegistrations lives under `messaging.twilio.com/v1/a2p/
// BrandRegistrations` (BACKEND_SPEC's own text guessed `api.twilio.com/v1/
// a10dlc/...`, which this build corrects) and Campaign (UsAppToPerson)
// registration is a Messaging-Service subresource,
// `/v1/Services/{MessagingServiceSid}/Compliance/Usa2p` — both fields lists
// below are the documented-as-of-2026 minimum, flagged for a live-sandbox
// confirmation pass before the first real registration.
// ---------------------------------------------------------------------

const TWILIO_MESSAGING_BASE_URL = "https://messaging.twilio.com/v1";

/**
 * VERIFY-confirmed (docs/VERIFY.md, `twilio` npm SDK v6.1.0's own
 * `lib/base/RequestClient.js`): Twilio's form-encoded REST API serializes
 * array-valued params as the SAME key repeated once per value
 * (`qs.stringify(data, {arrayFormat: "repeat"})`), e.g.
 * `MessageSamples=a&MessageSamples=b`, NOT an indexed-suffix convention
 * (`SampleMessage1`, `SampleMessage2`, ...) — that indexed form was this
 * build's original (wrong) guess, fixed here. `URLSearchParams` supports
 * this natively via repeated `.append()` calls for the same key.
 */
async function twilioMessagingRequest(
  fetchImpl: TwilioFetch,
  accountSid: string,
  authToken: string,
  path: string,
  params: Record<string, string | string[]>,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const v of value) body.append(key, v);
    } else {
      body.append(key, value);
    }
  }
  const res = await fetchImpl(`${TWILIO_MESSAGING_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      authorization: basicAuthHeader(accountSid, authToken),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const responseBody = await res.json().catch(() => undefined);
  return { ok: res.ok, status: res.status, body: responseBody };
}

/** POST /v1/Services — a Messaging Service is the unit A2P campaigns
 * register against (not a bare phone number); one per tenant, created
 * lazily by `/api-a2p-register` the first time a tenant registers. */
export async function createMessagingService(
  fetchImpl: TwilioFetch,
  accountSid: string,
  authToken: string,
  friendlyName: string,
) {
  return twilioMessagingRequest(fetchImpl, accountSid, authToken, "/Services", {
    FriendlyName: friendlyName,
  });
}

/** POST /v1/Services/{Sid}/PhoneNumbers — attaches a tenant's already-
 * purchased number (by its Twilio `PhoneNumberSid`, i.e.
 * `phone_numbers.twilio_sid`) to that tenant's Messaging Service. */
export async function addPhoneNumberToMessagingService(
  fetchImpl: TwilioFetch,
  accountSid: string,
  authToken: string,
  messagingServiceSid: string,
  phoneNumberSid: string,
) {
  return twilioMessagingRequest(
    fetchImpl,
    accountSid,
    authToken,
    `/Services/${messagingServiceSid}/PhoneNumbers`,
    { PhoneNumberSid: phoneNumberSid },
  );
}

/** POST /v1/a2p/BrandRegistrations — platform-level, once (Week-0 setup per
 * API_AND_FLOWS.md A.2), under the platform's own primary Business Profile
 * (Business Type = "ISV Reseller or Partner"). `customerProfileBundleSid`/
 * `a2pProfileBundleSid` reference the pre-created Trust Hub profile bundles
 * (not modeled here — a manual Console/Trust Hub setup step, same "lead
 * time" note SYSTEM_DESIGN §13 makes). */
export async function createBrandRegistration(
  fetchImpl: TwilioFetch,
  accountSid: string,
  authToken: string,
  params: {
    customerProfileBundleSid: string;
    a2pProfileBundleSid: string;
    brandType?: "STANDARD" | "SOLE_PROPRIETOR";
  },
) {
  return twilioMessagingRequest(fetchImpl, accountSid, authToken, "/a2p/BrandRegistrations", {
    CustomerProfileBundleSid: params.customerProfileBundleSid,
    A2PProfileBundleSid: params.a2pProfileBundleSid,
    ...(params.brandType ? { BrandType: params.brandType } : {}),
  });
}

export async function getBrandRegistration(
  fetchImpl: TwilioFetch,
  accountSid: string,
  authToken: string,
  brandSid: string,
) {
  const res = await fetchImpl(`${TWILIO_MESSAGING_BASE_URL}/a2p/BrandRegistrations/${brandSid}`, {
    method: "GET",
    headers: { authorization: basicAuthHeader(accountSid, authToken) },
  });
  const body = await res.json().catch(() => undefined);
  return { ok: res.ok, status: res.status, body };
}

/** POST /v1/Services/{MessagingServiceSid}/Compliance/Usa2p — per-tenant
 * campaign registration against the shared platform brand, fired
 * non-blocking during provisioning (Flow 2 step 6); the tenant sits in
 * `a2p_status='pending_verification'` until TCR vets it (1-5 business
 * days). `PrivacyPolicyUrl`/`TermsAndConditionsUrl` are required as of the
 * documented 2026-06-30 Twilio campaign-registration change (both must
 * resolve to the platform's own hosted policy pages, not the tenant's).
 * `MessageSamples` (VERIFY-confirmed field name, see `twilioMessagingRequest`
 * docstring) is a REQUIRED param per the official SDK's own generated
 * client (`params["messageSamples"]` throws if missing) — this build's
 * earlier `SampleMessage1`/`SampleMessage2` guess sent no field Twilio
 * actually recognizes at all, meaning `sampleMessages` was silently dropped
 * on every real call; fixed to the confirmed name. */
export async function createA2pCampaign(
  fetchImpl: TwilioFetch,
  accountSid: string,
  authToken: string,
  messagingServiceSid: string,
  params: {
    brandRegistrationSid: string;
    description: string;
    messageFlow: string;
    usAppToPersonUsecase: string;
    hasEmbeddedLinks: boolean;
    hasEmbeddedPhone: boolean;
    privacyPolicyUrl: string;
    termsAndConditionsUrl: string;
    sampleMessages: string[];
  },
) {
  const body: Record<string, string | string[]> = {
    BrandRegistrationSid: params.brandRegistrationSid,
    Description: params.description,
    MessageFlow: params.messageFlow,
    UsAppToPersonUsecase: params.usAppToPersonUsecase,
    HasEmbeddedLinks: String(params.hasEmbeddedLinks),
    HasEmbeddedPhone: String(params.hasEmbeddedPhone),
    PrivacyPolicyUrl: params.privacyPolicyUrl,
    TermsAndConditionsUrl: params.termsAndConditionsUrl,
    MessageSamples: params.sampleMessages,
  };
  return twilioMessagingRequest(
    fetchImpl,
    accountSid,
    authToken,
    `/Services/${messagingServiceSid}/Compliance/Usa2p`,
    body,
  );
}

export async function getA2pCampaign(
  fetchImpl: TwilioFetch,
  accountSid: string,
  authToken: string,
  messagingServiceSid: string,
  campaignSid: string,
) {
  const res = await fetchImpl(
    `${TWILIO_MESSAGING_BASE_URL}/Services/${messagingServiceSid}/Compliance/Usa2p/${campaignSid}`,
    { method: "GET", headers: { authorization: basicAuthHeader(accountSid, authToken) } },
  );
  const body = await res.json().catch(() => undefined);
  return { ok: res.ok, status: res.status, body };
}

export async function releasePhoneNumber(
  fetchImpl: TwilioFetch,
  accountSid: string,
  authToken: string,
  twilioSid: string,
): Promise<{ ok: boolean; status: number }> {
  const res = await fetchImpl(
    `${TWILIO_BASE_URL}/Accounts/${accountSid}/IncomingPhoneNumbers/${twilioSid}.json`,
    { method: "DELETE", headers: { authorization: basicAuthHeader(accountSid, authToken) } },
  );
  return { ok: res.ok, status: res.status };
}
