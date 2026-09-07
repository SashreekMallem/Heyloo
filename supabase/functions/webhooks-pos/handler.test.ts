import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../_shared/logger.js";
import type { SqlClient } from "../_shared/types.js";
import { processPosWebhook } from "./handler.js";

function makeSql(responses: Record<string, unknown[]>): SqlClient {
  return (async (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("update public.adapter_connections")) return responses["revoke"] ?? [];
    if (text.includes("select tenant_id, entity_type, entity_id, sync_conflict"))
      return responses["lookup"] ?? [];
    if (text.includes("update public.adapter_sync_state")) return responses["flag"] ?? [];
    return [];
  }) as unknown as SqlClient;
}

describe("processPosWebhook", () => {
  it("marks the matching connection disconnected on auth_revoked and logs error-level (compliance-visible)", async () => {
    const errors: unknown[] = [];
    const logger = {
      ...createLogger(),
      error: (msg: string, f?: unknown) => errors.push({ msg, f }),
    };
    const sql = makeSql({ revoke: [{ tenant_id: "tenant_1" }] });

    await processPosWebhook(
      sql,
      "square",
      { type: "auth_revoked", external_id: "merchant_1", changes: {} },
      logger,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ msg: "pos_adapter_auth_revoked" });
  });

  it("logs a warning (never throws) when no connection matches the revoked account id", async () => {
    const warnings: unknown[] = [];
    const logger = {
      ...createLogger(),
      warn: (msg: string, f?: unknown) => warnings.push({ msg, f }),
    };
    const sql = makeSql({ revoke: [] });

    await processPosWebhook(
      sql,
      "square",
      { type: "auth_revoked", external_id: "unknown_merchant", changes: {} },
      logger,
    );
    expect(warnings).toHaveLength(1);
  });

  it("flags sync_conflict when an external change arrives for a booking/order Heyloo already pushed", async () => {
    const infos: unknown[] = [];
    const logger = {
      ...createLogger(),
      info: (msg: string, f?: unknown) => infos.push({ msg, f }),
    };
    const flagCalls: unknown[] = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      if (text.includes("select tenant_id, entity_type, entity_id, sync_conflict")) {
        return Promise.resolve([
          {
            tenant_id: "tenant_1",
            entity_type: "booking",
            entity_id: "booking_1",
            sync_conflict: false,
          },
        ]);
      }
      if (text.includes("update public.adapter_sync_state")) {
        flagCalls.push(values);
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    }) as unknown as SqlClient;

    await processPosWebhook(
      sql,
      "square",
      { type: "order_changed", external_id: "order_1", changes: {} },
      logger,
    );
    expect(flagCalls).toHaveLength(1);
    expect(
      infos.some((i: any) => i.msg === "pos_adapter_change_recorded" && i.f.flagged_conflict),
    ).toBe(true);
  });

  it("does not re-flag an already-conflicted row", async () => {
    const logger = createLogger();
    const flagCalls: unknown[] = [];
    const sql = ((strings: TemplateStringsArray) => {
      const text = strings.join("?");
      if (text.includes("select tenant_id, entity_type, entity_id, sync_conflict")) {
        return Promise.resolve([
          {
            tenant_id: "tenant_1",
            entity_type: "booking",
            entity_id: "booking_1",
            sync_conflict: true,
          },
        ]);
      }
      if (text.includes("update public.adapter_sync_state")) {
        flagCalls.push(1);
      }
      return Promise.resolve([]);
    }) as unknown as SqlClient;

    await processPosWebhook(
      sql,
      "square",
      { type: "booking_changed", external_id: "booking_x", changes: {} },
      logger,
    );
    expect(flagCalls).toHaveLength(0);
  });

  it("records an unmapped external change (never a conflict) when nothing matches", async () => {
    const logger = createLogger();
    const sql = makeSql({ lookup: [] });
    await expect(
      processPosWebhook(
        sql,
        "square",
        { type: "order_changed", external_id: "order_unmapped", changes: {} },
        logger,
      ),
    ).resolves.toBeUndefined();
  });

  it("does not throw on an unknown canonical event type", async () => {
    const logger = createLogger();
    const sql = makeSql({});
    await expect(
      processPosWebhook(sql, "square", { type: "unknown", external_id: null, changes: {} }, logger),
    ).resolves.toBeUndefined();
  });

  it("does not query the database when an auth_revoked event carries no external_id", async () => {
    const logger = createLogger();
    const calls = vi.fn();
    const sql = ((..._args: unknown[]) => {
      calls();
      return Promise.resolve([]);
    }) as unknown as SqlClient;
    await processPosWebhook(
      sql,
      "square",
      { type: "auth_revoked", external_id: null, changes: {} },
      logger,
    );
    expect(calls).not.toHaveBeenCalled();
  });
});
