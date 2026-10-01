import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import { VERTICAL_DEFAULTS } from "../_shared/vertical-defaults.ts";
import { handleTenantTestCall } from "./handler.ts";

const logger = createLogger();

/**
 * Answers the handler's own lookup with `rows`, and the shared web-call
 * variable lookup (`_shared/web-call-variables.ts`, recognizable by its
 * `business_hours` column) with `webCallRows`: empty by default, which
 * exercises the disclosure-only fallback.
 */
function makeSql(rows: unknown[], webCallRows: unknown[] | Error = []): SqlClient {
  return ((strings: TemplateStringsArray) => {
    if (strings.join("?").includes("t.business_hours")) {
      return webCallRows instanceof Error
        ? Promise.reject(webCallRows)
        : Promise.resolve(webCallRows);
    }
    return Promise.resolve(rows);
  }) as unknown as SqlClient;
}

const NOW = new Date("2026-10-01T16:00:00Z");

const webCallTenantRow = {
  tenant_id: "t1",
  business_name: "Bright Smile Dental",
  vertical: "dental",
  timezone: "America/New_York",
  business_hours: VERTICAL_DEFAULTS.dental.business_hours,
  hours_exceptions: [],
  manual_mode: false,
  language_primary: "en",
  assistant_name: null,
  special_instructions: null,
  dynamic_variable_overrides: null,
  transfer_number: null,
  disclosure_line: "This call may be recorded by AI.",
};

describe("handleTenantTestCall", () => {
  it("404s when the tenant has no published agent", async () => {
    const sql = makeSql([{ retell_agent_id: null, disclosure_line: null }]);
    const result = await handleTenantTestCall(sql, "t1", {
      retellFetch: async () => new Response("{}"),
      retellApiKey: "k",
      logger,
    });
    expect(result).toEqual({ status: 404, body: { error: "agent_not_published" } });
  });

  it("404s when no agent_configs row exists at all", async () => {
    const sql = makeSql([]);
    const result = await handleTenantTestCall(sql, "t1", {
      retellFetch: async () => new Response("{}"),
      retellApiKey: "k",
      logger,
    });
    expect(result).toEqual({ status: 404, body: { error: "agent_not_published" } });
  });

  it("returns access_token + call_id on a successful web call", async () => {
    const sql = makeSql([
      { retell_agent_id: "agent_1", disclosure_line: "This call may be recorded by AI." },
    ]);
    let capturedBody: unknown;
    const result = await handleTenantTestCall(sql, "t1", {
      retellFetch: async (_url: string, init?: RequestInit) => {
        capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
        return new Response(JSON.stringify({ access_token: "tok_abc", call_id: "call_abc" }), {
          status: 201,
        });
      },
      retellApiKey: "k",
      logger,
    });
    expect(result).toEqual({
      status: 200,
      body: { access_token: "tok_abc", call_id: "call_abc" },
    });
    expect(capturedBody).toMatchObject({
      agent_id: "agent_1",
      retell_llm_dynamic_variables: { disclosure_line: "This call may be recorded by AI." },
    });
  });

  describe("per-call dynamic variables (a web call never runs /voice-inbound)", () => {
    async function run(webCallRows: unknown[] | Error) {
      const sql = makeSql(
        [{ retell_agent_id: "agent_1", disclosure_line: "This call may be recorded by AI." }],
        webCallRows,
      );
      let capturedBody: Record<string, unknown> | undefined;
      const result = await handleTenantTestCall(sql, "t1", {
        retellFetch: async (_url: string, init?: RequestInit) => {
          capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
          return new Response(JSON.stringify({ access_token: "tok", call_id: "call" }), {
            status: 201,
          });
        },
        retellApiKey: "k",
        logger,
        now: () => NOW,
      });
      return { result, vars: capturedBody?.["retell_llm_dynamic_variables"] };
    }

    it("sends the same variables a phone call gets", async () => {
      const { result, vars } = await run([webCallTenantRow]);
      expect(result.status).toBe(200);
      expect(vars).toMatchObject({
        business_name: "Bright Smile Dental",
        current_date: "2026-10-01",
        current_weekday: "Thursday",
        disclosure_line: "This call may be recorded by AI.",
        caller_greeting: "",
      });
      expect(Object.values(vars as object).every((v) => typeof v === "string")).toBe(true);
    });

    it("falls back to the disclosure line alone when the variable build fails", async () => {
      const { result, vars } = await run(new Error("db down"));
      expect(result.status).toBe(200);
      expect(vars).toEqual({ disclosure_line: "This call may be recorded by AI." });
    });
  });

  it("502s when Retell refuses/errors the web call", async () => {
    const sql = makeSql([{ retell_agent_id: "agent_1", disclosure_line: "disclosure" }]);
    const result = await handleTenantTestCall(sql, "t1", {
      retellFetch: async () => new Response(JSON.stringify({ error: "bad" }), { status: 400 }),
      retellApiKey: "k",
      logger,
    });
    expect(result).toEqual({ status: 502, body: { error: "call_token_unavailable" } });
  });
});
