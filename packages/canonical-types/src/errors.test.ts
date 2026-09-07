import { describe, expect, it } from "vitest";
import {
  DisclosureGateError,
  PayloadValidationError,
  SignatureVerificationError,
  VoiceProviderError,
} from "./errors.js";

describe("VoiceProviderError", () => {
  it("carries code/provider/retryable and an optional http status", () => {
    const err = new VoiceProviderError("rate limited", {
      code: "rate_limit",
      provider: "retell",
      retryable: true,
      httpStatus: 429,
    });
    expect(err.code).toBe("rate_limit");
    expect(err.provider).toBe("retell");
    expect(err.retryable).toBe(true);
    expect(err.httpStatus).toBe(429);
    expect(err).toBeInstanceOf(Error);
  });

  it("preserves the cause chain", () => {
    const cause = new Error("network reset");
    const err = new VoiceProviderError("upstream failed", {
      code: "network",
      provider: "retell",
      retryable: true,
      cause,
    });
    expect(err.cause).toBe(cause);
  });
});

describe("SignatureVerificationError", () => {
  it("is a non-retryable auth error", () => {
    const err = new SignatureVerificationError("retell", "stale timestamp");
    expect(err.code).toBe("auth");
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("retell");
    expect(err.message).toContain("stale timestamp");
  });
});

describe("PayloadValidationError", () => {
  it("is a non-retryable validation error naming the context", () => {
    const err = new PayloadValidationError("retell", "call_ended webhook");
    expect(err.code).toBe("validation");
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("call_ended webhook");
  });
});

describe("DisclosureGateError", () => {
  it("names the template and compile target", () => {
    const err = new DisclosureGateError("auto-v3", "conversation_flow");
    expect(err.message).toContain("auto-v3");
    expect(err.message).toContain("conversation_flow");
    expect(err.message.toLowerCase()).toContain("disclosure");
  });
});
