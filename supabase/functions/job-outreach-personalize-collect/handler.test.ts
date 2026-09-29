import { describe, expect, it, vi } from "vitest";
import { type FakeLlm, fakeLlm, textOk } from "../_shared/providers/llm/test-support.ts";
import type { LlmBatchStatus, LlmResult, LlmTextResponse } from "../_shared/providers/llm/types.ts";
import { llmFailure } from "../_shared/providers/llm/types.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";
import { collectResearchBatch, findInFlightResearchBatchIds } from "./handler.ts";

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

function jsonRes(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** An LLM whose batch has the given status and whose hook write returns `hook`. */
function llmWith(
  status: LlmBatchStatus,
  hook: (system: string | undefined) => LlmResult<LlmTextResponse> = () =>
    textOk("Loved what Acme is building — quick question."),
): FakeLlm {
  return fakeLlm({
    batch: { get: async () => ({ ok: true, status }) },
    text: (req) => hook(req.system),
  });
}

const succeeded = (results: { key: string; text: string | null }[]): LlmBatchStatus => ({
  state: "succeeded",
  results,
});

describe("findInFlightResearchBatchIds", () => {
  it("returns distinct batch ids for queued, not-yet-personalized leads", async () => {
    const { sql } = makeSql({
      "from public.leads": [{ batch_id: "batches/1" }, { batch_id: "msgbatch_2" }],
    });
    const ids = await findInFlightResearchBatchIds(sql);
    expect(ids).toEqual(["batches/1", "msgbatch_2"]);
  });
});

describe("collectResearchBatch", () => {
  const baseDeps = {
    smartleadApiKey: "key",
    canSpamFooter: "Acme Inc, 123 Main St. Unsubscribe anytime.",
    logger: makeLogger(),
    now: new Date("2026-01-01T00:00:00Z"),
  };
  const smartlead = () => vi.fn(async () => jsonRes({ added_count: 1 })) as never;

  it("does nothing and reports not-ended while the batch is still in progress", async () => {
    const { sql, calls } = makeSql();
    const llm = llmWith({ state: "in_progress" });
    const result = await collectResearchBatch(sql, "batches/1", {
      ...baseDeps,
      llm,
      smartleadFetch: vi.fn() as never,
    });
    expect(result.ended).toBe(false);
    expect(result.collected).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("does nothing and reports not-ended when the batch status call fails", async () => {
    const { sql } = makeSql();
    const llm = fakeLlm({
      batch: { get: async () => llmFailure("unavailable", 503, "down", true) },
    });
    const result = await collectResearchBatch(sql, "batches/1", {
      ...baseDeps,
      llm,
      smartleadFetch: vi.fn() as never,
    });
    expect(result).toEqual({ collected: 0, ended: false });
  });

  it("writes personalization, records costs, and pushes to Smartlead for a succeeded, emailed lead", async () => {
    const { sql, calls } = makeSql({
      "from public.leads": [
        { id: "l1", company_name: "Acme", contact_name: "Jane Doe", email: "jane@acme.com" },
      ],
      "from public.send_events": [{ id: "se1", campaign_id: "camp1" }],
      "from public.campaigns": [{ external_campaign_id: "ext_1", provider: "smartlead" }],
    });
    const llm = llmWith(succeeded([{ key: "l1", text: "Acme does great work." }]));

    const result = await collectResearchBatch(sql, "batches/1", {
      ...baseDeps,
      llm,
      smartleadFetch: smartlead(),
    });

    expect(result.ended).toBe(true);
    expect(result.collected).toBe(1);
    // The hook write is a quality-tier text call carrying the research text.
    expect(llm.calls.text[0]?.tier).toBe("quality");
    expect(String(llm.calls.text[0]?.input)).toContain("Acme does great work.");
    expect(calls.some((c) => c.text.includes("jsonb_build_object"))).toBe(true);
    // JSONB-2: untyped parameters inside jsonb_build_object (a variadic "any"
    // function) fail at prepare time with 42P18 "could not determine data type
    // of parameter" — each must carry an explicit ::text cast.
    const personalizationSql = calls.find((c) => c.text.includes("jsonb_build_object"))?.text ?? "";
    expect(personalizationSql).toMatch(/'research',\s*\S*\s*::text/);
    expect(personalizationSql).toMatch(/'opening_line',\s*\S*\s*::text/);
    expect(calls.some((c) => c.text.includes("insert into public.pipeline_costs"))).toBe(true);
    expect(calls.some((c) => c.text.includes("insert into public.cac_events"))).toBe(true);
    expect(
      calls.some((c) => c.text.includes("update public.send_events set status = 'sent'")),
    ).toBe(true);
    expect(calls.some((c) => c.text.includes("update public.leads set status = 'sent'"))).toBe(
      true,
    );
  });

  it("reads the batch from its issuing vendor's client (batchLlm) while the hook uses the current provider", async () => {
    const { sql } = makeSql({
      "from public.leads": [
        { id: "l1", company_name: "Acme", contact_name: null, email: "jane@acme.com" },
      ],
      "from public.send_events": [{ id: "se1", campaign_id: "camp1" }],
      "from public.campaigns": [{ external_campaign_id: "ext_1", provider: "smartlead" }],
    });
    const hookLlm = llmWith({ state: "in_progress" });
    const batchLlm = llmWith(succeeded([{ key: "l1", text: "research" }]));
    const getSpy = vi.spyOn(batchLlm.batch, "get");
    const hookGetSpy = vi.spyOn(hookLlm.batch, "get");

    await collectResearchBatch(sql, "msgbatch_1", {
      ...baseDeps,
      llm: hookLlm,
      batchLlm,
      smartleadFetch: smartlead(),
    });

    expect(getSpy).toHaveBeenCalledWith("msgbatch_1");
    expect(hookGetSpy).not.toHaveBeenCalled();
    expect(hookLlm.calls.text).toHaveLength(1);
    expect(batchLlm.calls.text).toHaveLength(0);
  });

  it("falls back to a generic opener and still pushes when the research result errored", async () => {
    const { sql, calls } = makeSql({
      "from public.leads": [
        { id: "l1", company_name: "Acme", contact_name: null, email: "jane@acme.com" },
      ],
      "from public.send_events": [{ id: "se1", campaign_id: "camp1" }],
      "from public.campaigns": [{ external_campaign_id: "ext_1", provider: "smartlead" }],
    });
    const llm = llmWith(succeeded([{ key: "l1", text: null }]));

    const result = await collectResearchBatch(sql, "batches/1", {
      ...baseDeps,
      llm,
      smartleadFetch: smartlead(),
    });

    expect(result.collected).toBe(1);
    expect(llm.calls.text).toHaveLength(0);
    const personalizationCall = calls.find((c) => c.text.includes("jsonb_build_object"));
    expect(
      personalizationCall?.values.some(
        (v) => typeof v === "string" && v.includes("might be a good fit"),
      ),
    ).toBe(true);
  });

  it("collects a lead the results omit (generic opener) instead of leaving it queued forever", async () => {
    const { sql, calls } = makeSql({
      "from public.leads": [
        { id: "l1", company_name: "Acme", contact_name: null, email: "jane@acme.com" },
        { id: "l2", company_name: "Beta", contact_name: null, email: "bob@beta.com" },
      ],
      "from public.send_events": [{ id: "se1", campaign_id: "camp1" }],
      "from public.campaigns": [{ external_campaign_id: "ext_1", provider: "smartlead" }],
    });
    const llm = llmWith(succeeded([{ key: "l1", text: "Acme research" }]));

    const result = await collectResearchBatch(sql, "batches/1", {
      ...baseDeps,
      llm,
      smartleadFetch: smartlead(),
    });

    expect(result.collected).toBe(2);
    expect(calls.filter((c) => c.text.includes("jsonb_build_object"))).toHaveLength(2);
  });

  it("collects every lead with a generic opener when the whole batch failed or expired", async () => {
    const { sql, calls } = makeSql({
      "from public.leads": [
        { id: "l1", company_name: "Acme", contact_name: null, email: "jane@acme.com" },
      ],
      "from public.send_events": [{ id: "se1", campaign_id: "camp1" }],
      "from public.campaigns": [{ external_campaign_id: "ext_1", provider: "smartlead" }],
    });
    const logger = makeLogger();
    const llm = llmWith({ state: "failed", reason: "BATCH_STATE_EXPIRED" });

    const result = await collectResearchBatch(sql, "batches/1", {
      ...baseDeps,
      logger,
      llm,
      smartleadFetch: smartlead(),
    });

    expect(result).toEqual({ collected: 1, ended: true });
    expect(logger.warn).toHaveBeenCalledWith(
      "outreach_personalize_collect_batch_failed",
      expect.objectContaining({ reason: "BATCH_STATE_EXPIRED" }),
    );
    expect(calls.some((c) => c.text.includes("jsonb_build_object"))).toBe(true);
  });

  it("OUTREACH-2: instructs the hook write to reference the strongest phone-complaint snippet for a high-scoring lead", async () => {
    const { sql } = makeSql({
      "from public.leads": [
        {
          id: "l1",
          company_name: "Acme",
          contact_name: "Jane Doe",
          email: "jane@acme.com",
          phone_complaint_score: 0.8,
          phone_complaint_evidence: [{ snippet: "called three times and got voicemail" }],
        },
      ],
      "from public.send_events": [{ id: "se1", campaign_id: "camp1" }],
      "from public.campaigns": [{ external_campaign_id: "ext_1", provider: "smartlead" }],
    });
    const hookSystemPrompts: (string | undefined)[] = [];
    const llm = llmWith(succeeded([{ key: "l1", text: "Acme does great work." }]), (system) => {
      hookSystemPrompts.push(system);
      return textOk("Saw you're hard to reach by phone.");
    });

    const result = await collectResearchBatch(sql, "batches/1", {
      ...baseDeps,
      llm,
      smartleadFetch: smartlead(),
    });

    expect(result.collected).toBe(1);
    expect(hookSystemPrompts[0]).toContain("called three times and got voicemail");
  });

  it("OUTREACH-2: falls back directly to the complaint opener when the hook call fails for a high-scoring lead", async () => {
    const { sql, calls } = makeSql({
      "from public.leads": [
        {
          id: "l1",
          company_name: "Acme",
          contact_name: null,
          email: "jane@acme.com",
          phone_complaint_score: 0.9,
          phone_complaint_evidence: [{ snippet: "never picked up the phone" }],
        },
      ],
      "from public.send_events": [{ id: "se1", campaign_id: "camp1" }],
      "from public.campaigns": [{ external_campaign_id: "ext_1", provider: "smartlead" }],
    });
    const llm = llmWith(succeeded([{ key: "l1", text: "research text" }]), () =>
      llmFailure("unavailable", 500, "hook failed", true),
    );

    await collectResearchBatch(sql, "batches/1", {
      ...baseDeps,
      llm,
      smartleadFetch: smartlead(),
    });

    const personalizationCall = calls.find((c) => c.text.includes("jsonb_build_object"));
    expect(
      personalizationCall?.values.some(
        (v) => typeof v === "string" && v.includes("never picked up the phone"),
      ),
    ).toBe(true);
  });

  it("skips the Smartlead push when the lead has no email", async () => {
    const { sql, calls } = makeSql({
      "from public.leads": [{ id: "l1", company_name: "Acme", contact_name: null, email: null }],
    });
    const llm = llmWith(succeeded([{ key: "l1", text: "x" }]), () =>
      textOk("A quick note about your business."),
    );
    const smartleadFetch = vi.fn(async () => jsonRes({})) as never;

    await collectResearchBatch(sql, "batches/1", { ...baseDeps, llm, smartleadFetch });

    expect(smartleadFetch).not.toHaveBeenCalled();
    expect(calls.some((c) => c.text.includes("update public.leads set status = 'sent'"))).toBe(
      false,
    );
  });
});
