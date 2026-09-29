import { describe, expect, it } from "vitest";
import { isObfuscatedExistingUser, mapSignUpError } from "./auth-errors";

describe("mapSignUpError", () => {
  it.each([
    ["user_already_exists", "already_registered"],
    ["email_exists", "already_registered"],
    ["email_address_invalid", "invalid_email"],
    ["weak_password", "weak_password"],
    ["over_email_send_rate_limit", "rate_limited"],
    ["over_request_rate_limit", "rate_limited"],
    ["signup_disabled", "signup_disabled"],
    ["email_provider_disabled", "signup_disabled"],
    ["email_address_not_authorized", "email_not_deliverable"],
    ["validation_failed", "invalid_details"],
  ] as const)(
    "maps GoTrue code %s to %s with a specific message, never 'Something went wrong'",
    (code, kind) => {
      const mapped = mapSignUpError({ code, message: "raw gotrue message", status: 422 });
      expect(mapped.kind).toBe(kind);
      expect(mapped.message).not.toMatch(/something went wrong/i);
      expect(mapped.message.length).toBeGreaterThan(20);
    },
  );

  it("explains a rejected example/test-domain email", () => {
    expect(mapSignUpError({ code: "email_address_invalid" }).message).toMatch(/business email/i);
  });

  it("lists why a password is weak when GoTrue says (AuthWeakPasswordError.reasons)", () => {
    const mapped = mapSignUpError({ code: "weak_password", reasons: ["length", "pwned"] });
    expect(mapped.message).toContain("too short");
    expect(mapped.message).toContain("data breaches");
  });

  it("tells the customer how long to wait on the confirmation-email rate limit", () => {
    expect(mapSignUpError({ code: "over_email_send_rate_limit", status: 429 }).message).toMatch(
      /hour/,
    );
  });

  it("treats an unknown code with HTTP 429 as a rate limit", () => {
    expect(mapSignUpError({ code: "some_new_code", status: 429 }).kind).toBe("rate_limited");
  });

  it("surfaces the real GoTrue message for an unknown error instead of hiding it", () => {
    const mapped = mapSignUpError({
      code: "unexpected_failure",
      message: "Database error saving new user",
    });
    expect(mapped.kind).toBe("unknown");
    expect(mapped.message).toContain("Database error saving new user");
  });

  it("falls back to a plain sentence when there is no message either", () => {
    expect(mapSignUpError({}).message).toMatch(/couldn't create your account/i);
  });
});

describe("isObfuscatedExistingUser", () => {
  it("is true for the anti-enumeration success (a user with an empty identities array)", () => {
    expect(isObfuscatedExistingUser({ identities: [] })).toBe(true);
  });

  it("is false for a real new user, and when identities are not reported", () => {
    expect(isObfuscatedExistingUser({ identities: [{ provider: "email" }] })).toBe(false);
    expect(isObfuscatedExistingUser({})).toBe(false);
    expect(isObfuscatedExistingUser(null)).toBe(false);
  });
});
