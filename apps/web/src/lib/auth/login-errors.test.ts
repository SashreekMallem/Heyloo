import { describe, expect, it } from "vitest";
import { LOGIN_ERROR_MESSAGES, loginErrorMessage } from "./login-errors";

describe("loginErrorMessage (AUTH-06)", () => {
  it.each([
    ["429 status", { status: 429 }, "rateLimited"],
    ["rate-limit code", { code: "over_request_rate_limit" }, "rateLimited"],
    ["unconfirmed email", { status: 400, code: "email_not_confirmed" }, "unconfirmed"],
    ["retryable fetch error", { name: "AuthRetryableFetchError", status: 0 }, "network"],
    ["status 0", { status: 0 }, "network"],
    ["gateway 503", { status: 503 }, "network"],
    ["wrong credentials", { status: 400, code: "invalid_credentials" }, "invalid"],
    ["unknown", {}, "invalid"],
  ] as const)("%s", (_name, failure, key) => {
    expect(loginErrorMessage(failure)).toBe(LOGIN_ERROR_MESSAGES[key]);
  });
});
