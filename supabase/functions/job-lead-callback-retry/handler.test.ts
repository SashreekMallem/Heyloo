import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import {
  findDueLeadCallbackRetries,
  retryOneLeadCallback,
  runLeadCallbackRetrySweep,
} from "./handler.ts";

const logger = createLogger();

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

const NOW = new Date("2026-09-10T18:00:00Z"); // daytime UTC, not quiet hours for America/New_York

const DEFERRED_ROW = {
  id: "lcr_1",
  tenant_id: "t1",
  name: "Jamie Lead",
  phone_e164: "+15551234567",
};

describe("findDueLeadCallbackRetries", () => {
  it("selects deferred_quiet_hours rows past their scheduled_for", async () => {
    const { sql, calls } = makeSql({ "from public.lead_callback_requests": [DEFERRED_ROW] });
    const rows = await findDueLeadCallbackRetries(sql, NOW);
    expect(rows).toEqual([DEFERRED_ROW]);
    expect(calls[0]?.text).toContain("deferred_quiet_hours");
  });
});

describe("retryOneLeadCallback", () => {
  it("marks failed_tenant_not_found when the tenant no longer resolves", async () => {
    const { sql } = makeSql({ "from public.tenants t": [] });
    const outcome = await retryOneLeadCallback(
      sql,
      DEFERRED_ROW,
      { retellFetch: async () => new Response("{}"), retellApiKey: "k", logger },
      NOW,
    );
    expect(outcome).toBe("failed_tenant_not_found");
  });

  it("marks failed_not_configured when the tenant has no agent/number/disclosure configured", async () => {
    const { sql } = makeSql({
      "from public.tenants t": [
        {
          timezone: "America/New_York",
          retell_agent_id: null,
          disclosure_line: null,
          from_number: null,
        },
      ],
    });
    const outcome = await retryOneLeadCallback(
      sql,
      DEFERRED_ROW,
      { retellFetch: async () => new Response("{}"), retellApiKey: "k", logger },
      NOW,
    );
    expect(outcome).toBe("failed_not_configured");
  });

  it("places the call and returns 'called' when quiet hours have passed", async () => {
    const { sql } = makeSql({
      "from public.tenants t": [
        {
          timezone: "America/New_York",
          retell_agent_id: "agent_1",
          disclosure_line: "This call may be recorded by AI.",
          from_number: "+15559998888",
        },
      ],
      "from public.phone_numbers where e164": [{ id: "pn_1" }],
      "insert into public.call_logs": [{ id: "call_log_1" }],
    });
    const outcome = await retryOneLeadCallback(
      sql,
      DEFERRED_ROW,
      {
        retellFetch: async () =>
          new Response(JSON.stringify({ call_id: "call_abc" }), { status: 201 }),
        retellApiKey: "k",
        logger,
      },
      NOW,
    );
    expect(outcome).toBe("called");
  });

  it("re-defers (still quiet hours) rather than calling", async () => {
    const { sql } = makeSql({
      "from public.tenants t": [
        {
          timezone: "America/New_York",
          retell_agent_id: "agent_1",
          disclosure_line: "This call may be recorded by AI.",
          from_number: "+15559998888",
        },
      ],
    });
    // 2026-01-16T02:00:00Z = 21:00 EST local (quiet hours).
    const outcome = await retryOneLeadCallback(
      sql,
      DEFERRED_ROW,
      { retellFetch: async () => new Response("{}"), retellApiKey: "k", logger },
      new Date("2026-01-16T02:00:00.000Z"),
    );
    expect(outcome).toBe("deferred_quiet_hours");
  });
});

describe("runLeadCallbackRetrySweep", () => {
  it("tallies outcomes across every due row", async () => {
    const { sql } = makeSql({
      "from public.lead_callback_requests": [DEFERRED_ROW],
      "from public.tenants t": [
        {
          timezone: "America/New_York",
          retell_agent_id: "agent_1",
          disclosure_line: "This call may be recorded by AI.",
          from_number: "+15559998888",
        },
      ],
      "from public.phone_numbers where e164": [{ id: "pn_1" }],
      "insert into public.call_logs": [{ id: "call_log_1" }],
    });
    const tally = await runLeadCallbackRetrySweep(
      sql,
      {
        retellFetch: async () =>
          new Response(JSON.stringify({ call_id: "call_abc" }), { status: 201 }),
        retellApiKey: "k",
        logger,
      },
      NOW,
    );
    expect(tally.total).toBe(1);
    expect(tally.called).toBe(1);
  });

  it("returns an all-zero tally when nothing is due", async () => {
    const { sql } = makeSql({ "from public.lead_callback_requests": [] });
    const tally = await runLeadCallbackRetrySweep(
      sql,
      { retellFetch: async () => new Response("{}"), retellApiKey: "k", logger },
      NOW,
    );
    expect(tally).toEqual({
      called: 0,
      deferred_quiet_hours: 0,
      failed_not_configured: 0,
      failed_outbound_call: 0,
      failed_tenant_not_found: 0,
      total: 0,
    });
  });
});
