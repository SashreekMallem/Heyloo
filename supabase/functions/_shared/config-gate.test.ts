import { describe, expect, it } from "vitest";
import { isConfigured, missingConfig } from "./config-gate.ts";

/**
 * OPS-5 (docs/BUILD_NOTES.md): unit coverage for the "is this optional
 * integration configured" predicate that `webhooks-stripe`,
 * `webhooks-paypal`, `webhooks-twilio-sms`, and `api-text-chat`'s
 * `index.ts` each gate their `Deno.serve` handler on before doing any
 * signature verification or provider call — the no-secret path a cold
 * start with an unconfigured optional integration takes. Those `index.ts`
 * files themselves are Deno-only (excluded from this package's tsconfig
 * and vitest, since `index.ts` and `_shared/deno` are both excluded) and
 * are proven live via curl + edge logs instead (see docs/BUILD_NOTES.md's
 * OPS-5 entry); this file covers the actual boolean logic they each call.
 */
describe("missingConfig", () => {
  it("returns an empty list when every var is present", () => {
    expect(missingConfig({ A: "1", B: "2" })).toEqual([]);
  });

  it("names every unset var, in order", () => {
    expect(missingConfig({ A: "1", B: undefined, C: "" })).toEqual(["B", "C"]);
  });

  it("treats an empty string the same as undefined (matches _shared/deno/env.ts's missingEnv)", () => {
    expect(missingConfig({ A: "" })).toEqual(["A"]);
  });
});

describe("isConfigured", () => {
  it("is true only when every named var has a non-empty value", () => {
    expect(isConfigured({ STRIPE_WEBHOOK_SIGNING_SECRET: "whsec_x" })).toBe(true);
    expect(isConfigured({ STRIPE_WEBHOOK_SIGNING_SECRET: undefined })).toBe(false);
    expect(isConfigured({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: undefined })).toBe(false);
    expect(isConfigured({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" })).toBe(true);
  });

  it("is vacuously true for no vars (no-op gate)", () => {
    expect(isConfigured({})).toBe(true);
  });
});
