import { describe, expect, it } from "vitest";
import { hmacSha1Base64 } from "./crypto.js";
import { verifyTwilioSignature } from "./twilio-signature.js";

const AUTH_TOKEN = "test-twilio-auth-token";
const URL = "https://heyloo.example.com/functions/v1/webhooks-twilio-sms";

async function buildSignature(
  url: string,
  params: Record<string, string>,
  token: string,
): Promise<string> {
  const sorted = Object.keys(params).sort();
  let message = url;
  for (const key of sorted) message += key + params[key];
  return hmacSha1Base64(token, message);
}

describe("verifyTwilioSignature", () => {
  const params = { From: "+15551234567", To: "+15557654321", Body: "STOP", MessageSid: "SM123" };

  it("accepts a validly-signed request", async () => {
    const signature = await buildSignature(URL, params, AUTH_TOKEN);
    const result = await verifyTwilioSignature({
      url: URL,
      formParams: params,
      authToken: AUTH_TOKEN,
      signatureHeader: signature,
    });
    expect(result).toEqual({ valid: true });
  });

  it("is insensitive to the object key insertion order (params are sorted)", async () => {
    const signature = await buildSignature(URL, params, AUTH_TOKEN);
    const reordered = {
      Body: params.Body,
      MessageSid: params.MessageSid,
      From: params.From,
      To: params.To,
    };
    const result = await verifyTwilioSignature({
      url: URL,
      formParams: reordered,
      authToken: AUTH_TOKEN,
      signatureHeader: signature,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects when the auth token is missing (fail closed)", async () => {
    const signature = await buildSignature(URL, params, AUTH_TOKEN);
    const result = await verifyTwilioSignature({
      url: URL,
      formParams: params,
      authToken: undefined,
      signatureHeader: signature,
    });
    expect(result).toEqual({ valid: false, reason: "missing_secret" });
  });

  it("rejects a missing signature header", async () => {
    const result = await verifyTwilioSignature({
      url: URL,
      formParams: params,
      authToken: AUTH_TOKEN,
      signatureHeader: null,
    });
    expect(result).toEqual({ valid: false, reason: "missing_header" });
  });

  it("rejects when a form param is tampered with after signing", async () => {
    const signature = await buildSignature(URL, params, AUTH_TOKEN);
    const tampered = { ...params, Body: "not stop" };
    const result = await verifyTwilioSignature({
      url: URL,
      formParams: tampered,
      authToken: AUTH_TOKEN,
      signatureHeader: signature,
    });
    expect(result).toEqual({ valid: false, reason: "mismatch" });
  });

  it("rejects when the URL differs from what was signed", async () => {
    const signature = await buildSignature(URL, params, AUTH_TOKEN);
    const result = await verifyTwilioSignature({
      url: `${URL}/extra`,
      formParams: params,
      authToken: AUTH_TOKEN,
      signatureHeader: signature,
    });
    expect(result).toEqual({ valid: false, reason: "mismatch" });
  });
});
