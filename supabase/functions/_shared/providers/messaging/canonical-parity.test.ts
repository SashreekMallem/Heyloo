import * as canonical from "@heyloo/canonical-types";
import { describe, expect, it } from "vitest";
import type { ZodObject } from "zod";
import * as mirror from "./types.ts";

/**
 * The Deno runtime can't import `@heyloo/canonical-types`, so `types.ts`
 * mirrors `packages/canonical-types/src/messaging.ts`. This diffs the two
 * (same convention as `_shared/schemas/voice-tools.test.ts`): enum values,
 * object key sets, and each shared field's optional-ness.
 */

const ENUMS: Array<[string, readonly string[], readonly string[]]> = [
  ["SMS_PROVIDER_IDS", canonical.SMS_PROVIDER_IDS, mirror.SMS_PROVIDER_IDS],
  ["EMAIL_PROVIDER_IDS", canonical.EMAIL_PROVIDER_IDS, mirror.EMAIL_PROVIDER_IDS],
  ["SEND_FAILURE_CLASSES", canonical.SEND_FAILURE_CLASSES, mirror.SEND_FAILURE_CLASSES],
  ["INBOUND_KEYWORD_CLASSES", canonical.INBOUND_KEYWORD_CLASSES, mirror.INBOUND_KEYWORD_CLASSES],
  ["DELIVERY_STATUSES", canonical.DELIVERY_STATUSES, mirror.DELIVERY_STATUSES],
  ["SENDER_KINDS", canonical.SENDER_KINDS, mirror.SENDER_KINDS],
  [
    "SENDER_REGISTRATION_STATUSES",
    canonical.SENDER_REGISTRATION_STATUSES,
    mirror.SENDER_REGISTRATION_STATUSES,
  ],
  ["OWNER_ALERT_KINDS", canonical.OWNER_ALERT_KINDS, mirror.OWNER_ALERT_KINDS],
];

const OBJECTS: Array<[string, ZodObject, ZodObject]> = [
  ["SmsSendRequest", canonical.zSmsSendRequest, mirror.zSmsSendRequest],
  ["EmailSendRequest", canonical.zEmailSendRequest, mirror.zEmailSendRequest],
  ["CanonicalInboundSms", canonical.zCanonicalInboundSms, mirror.zCanonicalInboundSms],
  ["CanonicalDeliveryStatus", canonical.zCanonicalDeliveryStatus, mirror.zCanonicalDeliveryStatus],
  ["SenderRegistration", canonical.zSenderRegistration, mirror.zSenderRegistration],
];

describe("messaging types mirror @heyloo/canonical-types", () => {
  it.each(ENUMS)("%s has identical values", (_name, a, b) => {
    expect([...b]).toEqual([...a]);
  });

  it.each(OBJECTS)("%s has identical keys and optional-ness", (_name, a, b) => {
    expect(Object.keys(b.shape).sort()).toEqual(Object.keys(a.shape).sort());
    for (const key of Object.keys(a.shape)) {
      const optA = (a.shape[key] as { safeParse: (v: unknown) => { success: boolean } }).safeParse(
        undefined,
      ).success;
      const optB = (b.shape[key] as { safeParse: (v: unknown) => { success: boolean } }).safeParse(
        undefined,
      ).success;
      expect(optB, key).toBe(optA);
    }
  });

  it("SendResult accepts and rejects the same values", () => {
    const samples: unknown[] = [
      { ok: true, providerMessageId: "x" },
      { ok: true, providerMessageId: "" },
      {
        ok: false,
        failure: "deferred",
        httpStatus: 429,
        errorCode: "q",
        detail: "d",
        retryAfterSeconds: 60,
      },
      { ok: false, failure: "nope", httpStatus: 500, errorCode: null, detail: "d" },
    ];
    for (const sample of samples) {
      expect(mirror.zSendResult.safeParse(sample).success).toBe(
        canonical.zSendResult.safeParse(sample).success,
      );
    }
  });
});
