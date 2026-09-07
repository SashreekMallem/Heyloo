import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.js";
import { processPosWebhook } from "./handler.js";

describe("processPosWebhook", () => {
  it("logs an error-level event on auth_revoked (compliance-visible)", () => {
    const errors: unknown[] = [];
    const logger = {
      ...createLogger(),
      error: (msg: string, f?: unknown) => errors.push({ msg, f }),
    };
    processPosWebhook(
      "square",
      { type: "auth_revoked", external_id: "merchant_1", changes: {} },
      logger,
    );
    expect(errors).toHaveLength(1);
  });

  it("logs a recorded-change event for booking/order changes without throwing", () => {
    const logger = createLogger();
    expect(() =>
      processPosWebhook(
        "square",
        { type: "order_changed", external_id: "order_1", changes: {} },
        logger,
      ),
    ).not.toThrow();
  });

  it("does not throw on an unknown canonical event type", () => {
    const logger = createLogger();
    expect(() =>
      processPosWebhook("square", { type: "unknown", external_id: null, changes: {} }, logger),
    ).not.toThrow();
  });
});
