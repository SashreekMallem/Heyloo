import { beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_COMPILER_VERSION } from "../_shared/compiler/template-compiler.ts";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";

const publishMock = vi.fn();
vi.mock("../api-tenant-agent-publish/handler.ts", () => ({
  handlePublishAgent: (...args: unknown[]) => publishMock(...args),
}));

const { runAutoRepublish } = await import("./handler.ts");

function makeSql(claimed: Array<{ tenant_id: string; slug: string }>) {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    if (text.includes("auto_republish_attempted_at = now()")) return Promise.resolve(claimed);
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

const deps = {
  retellFetch: fetch,
  retellApiKey: "test",
  voiceToolsWebhookUrl: "https://x/voice-tools",
  eventsWebhookUrl: "https://x/voice-events",
  retellInboundWebhookUrl: "https://x/voice-inbound",
  logger: createLogger(),
};

describe("runAutoRepublish", () => {
  beforeEach(() => publishMock.mockReset());

  it("claims outdated active agents (real tenants first) and republishes each, keeping the old agent", async () => {
    publishMock.mockResolvedValue({ status: 200, body: { tenant_id: "t", agent_id: "a" } });
    const { sql, calls } = makeSql([
      { tenant_id: "t1", slug: "imperial" },
      { tenant_id: "t2", slug: "demo-auto-repair" },
    ]);

    const tally = await runAutoRepublish(sql, { ...deps, batchSize: 2 });

    expect(tally).toEqual({ candidates: 2, republished: 2, failed: 0 });
    const claim = calls[0];
    expect(claim?.text).toContain("t.status = 'active'");
    expect(claim?.text).toContain("ac.compiled_with_version <");
    expect(claim?.text).toContain("language_config ->> 'changed_at'");
    expect(claim?.text).toContain("order by t.is_test asc");
    expect(claim?.text).toContain("skip locked");
    expect(claim?.values).toContain(AGENT_COMPILER_VERSION);
    expect(claim?.values).toContain(2);
    expect(publishMock).toHaveBeenCalledTimes(2);
    for (const call of publishMock.mock.calls) {
      expect(call[3]).toEqual({ deleteSuperseded: false });
    }
  });

  it("records a failed publish so it is retried after the window, and keeps going", async () => {
    publishMock
      .mockResolvedValueOnce({ status: 502, body: { error: "retell_create_agent_failed" } })
      .mockResolvedValueOnce({ status: 200, body: { tenant_id: "t2", agent_id: "a" } });
    const { sql, calls } = makeSql([
      { tenant_id: "t1", slug: "a" },
      { tenant_id: "t2", slug: "b" },
    ]);

    const tally = await runAutoRepublish(sql, deps);

    expect(tally).toEqual({ candidates: 2, republished: 1, failed: 1 });
    const errorWrite = calls.find((c) => c.text.includes("set auto_republish_error ="));
    expect(errorWrite?.values).toEqual(["retell_create_agent_failed", "t1"]);
  });

  it("records a thrown error instead of failing the whole run", async () => {
    publishMock.mockRejectedValueOnce(new Error("network down"));
    const { sql, calls } = makeSql([{ tenant_id: "t1", slug: "a" }]);

    const tally = await runAutoRepublish(sql, deps);

    expect(tally).toEqual({ candidates: 1, republished: 0, failed: 1 });
    expect(calls.some((c) => c.values.includes("network down"))).toBe(true);
  });

  it("does nothing when every agent is current", async () => {
    const { sql } = makeSql([]);
    expect(await runAutoRepublish(sql, deps)).toEqual({
      candidates: 0,
      republished: 0,
      failed: 0,
    });
    expect(publishMock).not.toHaveBeenCalled();
  });
});
