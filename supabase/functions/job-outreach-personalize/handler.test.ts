import { describe, expect, it, vi } from "vitest";
import type { Logger, SqlClient } from "../_shared/types.ts";
import { findLeadsNeedingResearch, submitResearchBatch } from "./handler.ts";

function makeSql(fixtures: Record<string, unknown[]> = {}): {
  sql: SqlClient;
  calls: { text: string; values: unknown[] }[];
} {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    for (const [key, rows] of Object.entries(fixtures)) {
      if (text.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("findLeadsNeedingResearch", () => {
  it("selects only queued leads with no research batch or personalization yet", async () => {
    const { sql, calls } = makeSql({
      "from public.leads": [
        { id: "l1", vertical: "legal", company_name: "Acme", contact_name: null, enrichment: {} },
      ],
    });
    const rows = await findLeadsNeedingResearch(sql);
    expect(rows).toHaveLength(1);
    expect(calls[0]?.text).toContain("status = 'queued'");
  });
});

describe("submitResearchBatch", () => {
  it("submits one batch covering every lead and stamps research_batch_id", async () => {
    const { sql, calls } = makeSql();
    const anthropicFetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ id: "batch_123" }),
        }) as unknown as Response,
    ) as never;

    const result = await submitResearchBatch(
      sql,
      [
        {
          id: "l1",
          vertical: "legal",
          company_name: "Acme",
          contact_name: "Jane",
          enrichment: { website: "acme.com" },
        },
        { id: "l2", vertical: "legal", company_name: "Beta", contact_name: null, enrichment: {} },
      ],
      {
        anthropicFetch,
        anthropicApiKey: "key",
        researchModel: "claude-haiku-4-5",
        fetchUrl: async () => "<html><body>We fix cars fast.</body></html>",
        logger: makeLogger(),
      },
    );

    expect(result.submitted).toBe(2);
    expect(result.batchId).toBe("batch_123");
    expect(calls.some((c) => c.text.includes("research_batch_id"))).toBe(true);
  });

  it("does nothing when there are no leads to submit", async () => {
    const { sql } = makeSql();
    const result = await submitResearchBatch(sql, [], {
      anthropicFetch: vi.fn() as never,
      anthropicApiKey: "key",
      researchModel: "claude-haiku-4-5",
      fetchUrl: async () => null,
      logger: makeLogger(),
    });
    expect(result.submitted).toBe(0);
  });

  it("logs and returns 0 submitted when the batch API call fails", async () => {
    const { sql } = makeSql();
    const anthropicFetch = vi.fn(
      async () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response,
    ) as never;
    const logger = makeLogger();

    const result = await submitResearchBatch(
      sql,
      [{ id: "l1", vertical: "legal", company_name: "Acme", contact_name: null, enrichment: {} }],
      {
        anthropicFetch,
        anthropicApiKey: "key",
        researchModel: "claude-haiku-4-5",
        fetchUrl: async () => null,
        logger,
      },
    );

    expect(result.submitted).toBe(0);
    expect(logger.error).toHaveBeenCalled();
  });
});
