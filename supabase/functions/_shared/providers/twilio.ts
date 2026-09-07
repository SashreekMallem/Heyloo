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
