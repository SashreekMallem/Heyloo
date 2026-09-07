import { describe, expect, it } from "vitest";
import { handleEzyVetWebhook } from "./webhook.js";

describe("handleEzyVetWebhook", () => {
  it("always fails closed with an explicit reason rather than guessing an unconfirmed signature scheme", () => {
    expect(handleEzyVetWebhook()).toEqual({
      valid: false,
      reason: "ezyvet_webhook_scheme_unconfirmed_use_poll_sync",
    });
  });
});
