import { describe, expect, it, vi } from "vitest";
import type { Logger, SqlClient } from "../_shared/types.js";
import { handleFetchLeads } from "./handler.js";

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

function jsonFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn(
    async () => ({ ok, status, json: async () => body }) as unknown as Response,
  ) as never;
}

describe("handleFetchLeads (apollo)", () => {
  it("inserts new leads found via Apollo people search, dropping contactless records", async () => {
    const { sql, calls } = makeSql({ "insert into public.leads": [{ id: "lead_1" }] });
    const apolloFetch = jsonFetch({
      people: [
        {
          name: "Jane Doe",
          email: "jane@acme.com",
          organization: { name: "Acme", website_url: "acme.com" },
        },
        { name: "No Contact", organization: { name: "Nobody Inc" } },
      ],
    });

    const result = await handleFetchLeads(
      sql,
      { source: "apollo", vertical: "legal" },
      {
        apolloFetch,
        apolloApiKey: "key",
        outscraperFetch: vi.fn() as never,
        outscraperApiKey: "key",
        logger: makeLogger(),
        sleep: async () => {},
        now: new Date("2026-01-01T00:00:00Z"),
      },
    );

    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.inserted).toBe(1);
      expect(result.body.skipped_no_contact).toBe(1);
    }
    expect(calls.some((c) => c.text.includes("insert into public.leads"))).toBe(true);
  });

  it("skips a candidate already on the suppression list", async () => {
    const { sql } = makeSql({ "from public.suppression_list": [{ id: "s1" }] });
    const apolloFetch = jsonFetch({
      people: [{ name: "Jane Doe", email: "jane@acme.com", organization: { name: "Acme" } }],
    });

    const result = await handleFetchLeads(
      sql,
      { source: "apollo", vertical: "legal" },
      {
        apolloFetch,
        apolloApiKey: "key",
        outscraperFetch: vi.fn() as never,
        outscraperApiKey: "key",
        logger: makeLogger(),
        sleep: async () => {},
      },
    );

    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.inserted).toBe(0);
      expect(result.body.skipped_suppressed).toBe(1);
    }
  });

  it("returns 502 when the Apollo search call fails", async () => {
    const { sql } = makeSql();
    const apolloFetch = jsonFetch({}, false, 500);

    const result = await handleFetchLeads(
      sql,
      { source: "apollo", vertical: "legal" },
      {
        apolloFetch,
        apolloApiKey: "key",
        outscraperFetch: vi.fn() as never,
        outscraperApiKey: "key",
        logger: makeLogger(),
        sleep: async () => {},
      },
    );

    expect(result.status).toBe(502);
  });
});

describe("handleFetchLeads (outscraper)", () => {
  it("inserts leads from an inline (non-polled) Google Maps result and logs a list cost", async () => {
    const { sql, calls } = makeSql({ "insert into public.leads": [{ id: "lead_1" }] });
    const outscraperFetch = jsonFetch({
      id: "req_1",
      data: [
        [
          { name: "Joe's Diner", phone: "+15551234567", site: "joesdiner.com" },
          { name: "Sue's Cafe", phone: "+15559998888", site: "suescafe.com" },
        ],
      ],
    });

    const result = await handleFetchLeads(
      sql,
      { source: "outscraper", vertical: "restaurant", query: "restaurants in Austin, TX" },
      {
        apolloFetch: vi.fn() as never,
        apolloApiKey: "key",
        outscraperFetch,
        outscraperApiKey: "key",
        logger: makeLogger(),
        sleep: async () => {},
        now: new Date("2026-01-01T00:00:00Z"),
      },
    );

    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.inserted).toBe(2);
    }
    expect(calls.some((c) => c.text.includes("insert into public.pipeline_costs"))).toBe(true);
    expect(calls.some((c) => c.text.includes("insert into public.cac_events"))).toBe(true);
  });

  it("polls results_location when the initial response has no inline data", async () => {
    const { sql } = makeSql({ "insert into public.leads": [{ id: "lead_1" }] });
    let call = 0;
    const outscraperFetch = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "req_1", results_location: "https://x/results/req_1" }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: "Success",
          data: [[{ name: "Motel 6", phone: "+15551112222" }]],
        }),
      } as unknown as Response;
    }) as never;

    const result = await handleFetchLeads(
      sql,
      { source: "outscraper", vertical: "motel", query: "motels in Reno, NV" },
      {
        apolloFetch: vi.fn() as never,
        apolloApiKey: "key",
        outscraperFetch,
        outscraperApiKey: "key",
        logger: makeLogger(),
        sleep: async () => {},
      },
    );

    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.inserted).toBe(1);
    }
  });
});
