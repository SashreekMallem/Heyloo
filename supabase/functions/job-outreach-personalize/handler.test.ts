import { describe, expect, it, vi } from "vitest";
import { fakeLlm } from "../_shared/providers/llm/test-support.ts";
import { llmFailure } from "../_shared/providers/llm/types.ts";
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
  it("submits one batch covering every lead (key = lead id) and stamps research_batch_id", async () => {
    const { sql, calls } = makeSql();
    const llm = fakeLlm({
      batch: { submit: async () => ({ ok: true, batchId: "batches/abc123" }) },
    });
    const submit = vi.spyOn(llm.batch, "submit");

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
        llm,
        fetchUrl: async () => "<html><body>We fix cars fast.</body></html>",
        logger: makeLogger(),
      },
    );

    expect(result.submitted).toBe(2);
    expect(result.batchId).toBe("batches/abc123");
    expect(calls.some((c) => c.text.includes("research_batch_id"))).toBe(true);
    const sent = submit.mock.calls[0]?.[0];
    expect(sent?.tier).toBe("fast");
    expect(sent?.requests.map((r) => r.key)).toEqual(["l1", "l2"]);
    expect(sent?.requests[0]?.input).toContain("We fix cars fast.");
    expect(sent?.requests[1]?.input).toContain("(no website text available)");
    // Scraped site text is framed as untrusted data.
    expect(sent?.requests[0]?.system).toContain("untrusted data");
  });

  it("does nothing when there are no leads to submit", async () => {
    const { sql } = makeSql();
    const llm = fakeLlm();
    const result = await submitResearchBatch(sql, [], {
      llm,
      fetchUrl: async () => null,
      logger: makeLogger(),
    });
    expect(result.submitted).toBe(0);
  });

  it("logs and returns 0 submitted, stamping nothing, when the batch API call fails", async () => {
    const { sql, calls } = makeSql();
    const llm = fakeLlm({
      batch: { submit: async () => llmFailure("unavailable", 500, "boom", true) },
    });
    const logger = makeLogger();

    const result = await submitResearchBatch(
      sql,
      [{ id: "l1", vertical: "legal", company_name: "Acme", contact_name: null, enrichment: {} }],
      { llm, fetchUrl: async () => null, logger },
    );

    expect(result.submitted).toBe(0);
    expect(logger.error).toHaveBeenCalled();
    expect(calls.some((c) => c.text.includes("research_batch_id"))).toBe(false);
  });
});
