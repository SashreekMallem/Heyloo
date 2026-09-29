import type { TwilioFetch } from "../twilio.ts";
import {
  getIncomingPhoneNumber,
  releasePhoneNumber,
  updateIncomingPhoneNumberVoiceUrl,
} from "../twilio.ts";
import type { RetellNumberDeps } from "./retell-native.ts";
import { releaseRetellNumber } from "./retell-native.ts";
import type {
  FailoverSupport,
  NumberRecord,
  PhoneNumberProvider,
  ReleaseResult,
  RoutingCapture,
  RoutingChange,
} from "./types.ts";

export interface TwilioNumberDeps extends RetellNumberDeps {
  twilioFetch: TwilioFetch;
  /** Both optional: Twilio is not configured on this platform yet (OPS-5),
   * and Retell-native numbers never need it. */
  twilioAccountSid: string | undefined;
  twilioAuthToken: string | undefined;
}

/**
 * Adapter for a Twilio-owned number imported into Retell
 * (`phone_numbers.twilio_sid` = `PN...`). Two resources exist, so release is
 * two idempotent steps in a fixed order: un-import from Retell first (no
 * in-flight call is orphaned, G7), then release at Twilio
 * (`DELETE .../IncomingPhoneNumbers/{Sid}.json`, 204; 404 = already
 * released by a run that died before recording it).
 */
export function createTwilioProvider(deps: TwilioNumberDeps): PhoneNumberProvider {
  const creds = (): { sid: string; token: string } | null =>
    deps.twilioAccountSid && deps.twilioAuthToken
      ? { sid: deps.twilioAccountSid, token: deps.twilioAuthToken }
      : null;

  return {
    id: "twilio",
    failoverSupport(): FailoverSupport {
      return creds()
        ? { supported: true }
        : { supported: false, reason: "twilio_not_configured: no TWILIO_ACCOUNT_SID/AUTH_TOKEN" };
    },
    async release(number: NumberRecord): Promise<ReleaseResult> {
      const retell = await releaseRetellNumber(deps, number.e164);
      if (!retell.ok) return retell;
      const c = creds();
      if (!c || !number.twilioSid) {
        return { ok: false, reason: "twilio_not_configured", status: 0 };
      }
      const twilio = await releasePhoneNumber(deps.twilioFetch, c.sid, c.token, number.twilioSid);
      if (!twilio.ok && twilio.status !== 404) {
        return { ok: false, reason: "twilio_release_failed", status: twilio.status };
      }
      return { ok: true, alreadyReleased: retell.alreadyReleased && twilio.status === 404 };
    },
    async captureRouting(number: NumberRecord): Promise<RoutingCapture> {
      const c = creds();
      if (!c || !number.twilioSid) return { ok: false, status: 0 };
      const current = await getIncomingPhoneNumber(
        deps.twilioFetch,
        c.sid,
        c.token,
        number.twilioSid,
      );
      const voiceUrl = (current.body as { voice_url?: unknown } | undefined)?.voice_url;
      if (current.ok && typeof voiceUrl === "string" && voiceUrl)
        return { ok: true, token: voiceUrl };
      return { ok: false, status: current.status };
    },
    async divertRouting(number: NumberRecord, failoverUrl: string): Promise<RoutingChange> {
      return setVoiceUrl(number, failoverUrl);
    },
    async restoreRouting(number: NumberRecord, token: string): Promise<RoutingChange> {
      return setVoiceUrl(number, token);
    },
  };

  async function setVoiceUrl(number: NumberRecord, url: string): Promise<RoutingChange> {
    const c = creds();
    if (!c || !number.twilioSid) return { ok: false, status: 0 };
    const result = await updateIncomingPhoneNumberVoiceUrl(
      deps.twilioFetch,
      c.sid,
      c.token,
      number.twilioSid,
      url,
    );
    return result.ok ? { ok: true } : { ok: false, status: result.status };
  }
}
