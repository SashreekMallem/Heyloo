import { describe, expect, it, vi } from "vitest";
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

describe("findInFlightResearchBatchIds", () => {
  it("returns distinct batch ids for queued, not-yet-personalized leads", async () => {
    const { sql } = makeSql({
      "from public.leads": [{ batch_id: "batch_1" }, { batch_id: "batch_2" }],
    });
    const ids = await findInFlightResearchBatchIds(sql);
    expect(ids).toEqual(["batch_1", "batch_2"]);
  });
});

describe("collectResearchBatch", () => {
  const deps = {
    anthropicApiKey: "key",
    personalizeModel: "claude-sonnet-5",
    smartleadApiKey: "key",
    canSpamFooter: "Acme Inc, 123 Main St. Unsubscribe anytime.",
    logger: makeLogger(),
    now: new Date("2026-01-01T00:00:00Z"),
  };

  it("does nothing and reports not-ended while the batch is still in progress", async () => {
    const { sql } = makeSql();
    const anthropicFetch = vi.fn(async () =>
      jsonRes({ processing_status: "in_progress" }),
    ) as never;
    const result = await collectResearchBatch(sql, "batch_1", {
      ...deps,
      anthropicFetch,
      smartleadFetch: vi.fn() as never,
    });
    expect(result.ended).toBe(false);
    expect(result.collected).toBe(0);
  });

  it("writes personalization, records costs, and pushes to Smartlead for a succeeded, emailed lead", async () => {
    const { sql, calls } = makeSql({
      "from public.leads": [
        { id: "l1", company_name: "Acme", contact_name: "Jane Doe", email: "jane@acme.com" },
      ],
      "from public.send_events": [{ id: "se1", campaign_id: "camp1" }],
      "from public.campaigns": [{ external_campaign_id: "ext_1", provider: "smartlead" }],
    });

    let call = 0;
    const anthropicFetch = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return jsonRes({ processing_status: "ended", results_url: "https://x/results" });
      }
      if (call === 2) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            `${JSON.stringify({
              custom_id: "l1",
              result: {
                type: "succeeded",
                message: { content: [{ type: "text", text: "Acme does great work." }] },
              },
            })}\n`,
        } as unknown as Response;
      }
      return jsonRes({
        content: [{ type: "text", text: "Loved what Acme is building — quick question." }],
      });
    }) as never;

    const smartleadFetch = vi.fn(async () => jsonRes({ added_count: 1 })) as never;

    const result = await collectResearchBatch(sql, "batch_1", {
      ...deps,
      anthropicFetch,
      smartleadFetch,
    });

    expect(result.ended).toBe(true);
    expect(result.collected).toBe(1);
    expect(calls.some((c) => c.text.includes("'personalization'"))).toBe(true);
    expect(calls.some((c) => c.text.includes("insert into public.pipeline_costs"))).toBe(true);
    expect(calls.some((c) => c.text.includes("insert into public.cac_events"))).toBe(true);
    expect(
      calls.some((c) => c.text.includes("update public.send_events set status = 'sent'")),
    ).toBe(true);
    expect(calls.some((c) => c.text.includes("update public.leads set status = 'sent'"))).toBe(
      true,
    );
  });

  it("falls back to a generic opener and still pushes when the research result errored", async () => {
    const { sql, calls } = makeSql({
      "from public.leads": [
        { id: "l1", company_name: "Acme", contact_name: null, email: "jane@acme.com" },
      ],
      "from public.send_events": [{ id: "se1", campaign_id: "camp1" }],
      "from public.campaigns": [{ external_campaign_id: "ext_1", provider: "smartlead" }],
    });

    let call = 0;
    const anthropicFetch = vi.fn(async () => {
      call += 1;
      if (call === 1)
        return jsonRes({ processing_status: "ended", results_url: "https://x/results" });
      return {
        ok: true,
        status: 200,
        text: async () => `${JSON.stringify({ custom_id: "l1", result: { type: "errored" } })}\n`,
      } as unknown as Response;
    }) as never;
    const smartleadFetch = vi.fn(async () => jsonRes({ added_count: 1 })) as never;

    const result = await collectResearchBatch(sql, "batch_1", {
      ...deps,
      anthropicFetch,
      smartleadFetch,
    });

    expect(result.collected).toBe(1);
    const personalizationCall = calls.find((c) => c.text.includes("'personalization'"));
    expect(
      personalizationCall?.values.some(
        (v) => typeof v === "string" && v.includes("might be a good fit"),
      ),
    ).toBe(true);
  });

  it("skips the Smartlead push when the lead has no email", async () => {
    const { sql, calls } = makeSql({
      "from public.leads": [{ id: "l1", company_name: "Acme", contact_name: null, email: null }],
    });
    let call = 0;
    const anthropicFetch = vi.fn(async () => {
      call += 1;
      if (call === 1)
        return jsonRes({ processing_status: "ended", results_url: "https://x/results" });
      if (call === 2) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            `${JSON.stringify({ custom_id: "l1", result: { type: "succeeded", message: { content: [{ type: "text", text: "x" }] } } })}\n`,
        } as unknown as Response;
      }
      return jsonRes({ content: [{ type: "text", text: "A quick note about your business." }] });
    }) as never;
    const smartleadFetch = vi.fn(async () => jsonRes({})) as never;

    await collectResearchBatch(sql, "batch_1", { ...deps, anthropicFetch, smartleadFetch });

    expect(smartleadFetch).not.toHaveBeenCalled();
    expect(calls.some((c) => c.text.includes("update public.leads set status = 'sent'"))).toBe(
      false,
    );
  });
});
