import { describe, expect, it, vi } from "vitest";
import { classifyResendFailure, createResendEmailProvider } from "./resend.ts";
import { zSendResult } from "./types.ts";

const REQUEST = {
  to: "owner@example.com",
  from: "Heyloo <alerts@heyloo.app>",
  subject: "New message",
  html: "<p>Hi</p>",
  text: "Hi",
  idempotencyKey: "msg_1",
};

describe("Resend adapter", () => {
  it("POSTs /emails with Bearer auth, text+html, and the Idempotency-Key header", async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: "em_1" }), { status: 200 }),
    );
    const result = await createResendEmailProvider({ fetchImpl, apiKey: "re_key" }).sendEmail(
      REQUEST,
    );
    expect(result).toEqual({ ok: true, providerMessageId: "em_1" });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer re_key");
    expect(headers["idempotency-key"]).toBe("msg_1");
    expect(JSON.parse(String(init.body))).toEqual({
      from: REQUEST.from,
      to: REQUEST.to,
      subject: REQUEST.subject,
      html: REQUEST.html,
      text: REQUEST.text,
    });
  });

  it("classifies current Resend error names", () => {
    for (const name of [
      "validation_error",
      "missing_required_field",
      "invalid_parameter",
      "email_above_quota",
      "invalid_idempotent_request",
    ]) {
      expect(classifyResendFailure(422, { name, message: "m" })).toMatchObject({
        failure: "permanent",
        errorCode: name,
      });
    }
    const daily = classifyResendFailure(429, { name: "daily_quota_exceeded" });
    expect(daily).toMatchObject({ failure: "deferred", retryAfterSeconds: 3600 });
    expect(zSendResult.safeParse(daily).success).toBe(true);
    expect(classifyResendFailure(429, { name: "monthly_quota_exceeded" })).toMatchObject({
      failure: "deferred",
    });
    expect(classifyResendFailure(429, { name: "rate_limit_exceeded" })).toMatchObject({
      failure: "transient",
    });
    expect(classifyResendFailure(500, { name: "application_error" })).toMatchObject({
      failure: "transient",
    });
    // Names Resend no longer documents are not treated as permanent.
    expect(classifyResendFailure(422, { name: "invalid_to_address" })).toMatchObject({
      failure: "transient",
    });
  });

  it("maps a network error to a transient failure instead of throwing", async () => {
    const provider = createResendEmailProvider({
      fetchImpl: async () => {
        throw new TypeError("reset");
      },
      apiKey: "k",
    });
    expect(await provider.sendEmail(REQUEST)).toMatchObject({ ok: false, failure: "transient" });
  });
});
