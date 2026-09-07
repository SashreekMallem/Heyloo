import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.js";
import type { SqlClient } from "../_shared/types.js";
import { pushToAdapter } from "./handler.js";

describe("pushToAdapter", () => {
  it("returns false and logs a warning for an adapter with no registered pusher yet", async () => {
    const warnings: unknown[] = [];
    const logger = {
      ...createLogger(),
      warn: (msg: string, f?: unknown) => warnings.push({ msg, f }),
    };
    const sql = (() => Promise.resolve([])) as SqlClient;
    const result = await pushToAdapter(
      sql,
      {
        tenant_id: "t1",
        adapter: "square",
        entity_type: "order",
        entity_id: "o1",
        idempotency_key: "k1",
        attempt: 0,
      },
      logger,
    );
    expect(result).toBe(false);
    expect(warnings).toHaveLength(1);
  });
});
