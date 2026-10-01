import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.ts";
import type { SqlClient } from "./types.ts";
import { VERTICAL_DEFAULTS } from "./vertical-defaults.ts";
import {
  buildWebCallDynamicVariables,
  DEFAULT_DISCLOSURE_LINE,
  resolveWebCallDynamicVariables,
  toStringVariables,
} from "./web-call-variables.ts";

const logger = createLogger();
const NOW = new Date("2026-10-01T16:00:00Z");

interface RecordedQuery {
  text: string;
  values: unknown[];
}

function makeRoutedSql(routes: Record<string, unknown[] | Error>) {
  const calls: RecordedQuery[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });
    for (const [needle, result] of Object.entries(routes)) {
      if (text.includes(needle)) {
        return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
      }
    }
    return Promise.resolve([]);
  }) as unknown as SqlClient;
  return { sql, calls };
}

const tenantRow = {
  tenant_id: "t1",
  business_name: "Bright Smile Dental",
  vertical: "dental",
  timezone: "America/New_York",
  business_hours: VERTICAL_DEFAULTS.dental.business_hours,
  hours_exceptions: [],
  manual_mode: false,
  language_primary: "en",
  assistant_name: "Maya",
  special_instructions: null,
  dynamic_variable_overrides: null,
  transfer_number: null,
  disclosure_line: "You are speaking with an AI assistant. This call is recorded.",
};

describe("toStringVariables", () => {
  it("stringifies booleans and arrays and drops null/undefined", () => {
    expect(
      toStringVariables({ a: "x", b: true, c: ["one", "two"], d: null, e: undefined, f: 3 }),
    ).toEqual({ a: "x", b: "true", c: "one, two", f: "3" });
  });
});

describe("buildWebCallDynamicVariables", () => {
  it("looks up the given tenant only, skipping deleted tenants", async () => {
    const { sql, calls } = makeRoutedSql({ "from public.tenants t": [tenantRow] });
    await buildWebCallDynamicVariables({ sql, logger, now: NOW, tenantId: "t1" });
    const lookup = calls.find((c) => c.text.includes("from public.tenants t"));
    expect(lookup?.values).toEqual(["t1"]);
    expect(lookup?.text).toContain("t.deleted_at is null");
  });

  it("builds the same variables a phone call gets, as strings, with blank caller history", async () => {
    const { sql, calls } = makeRoutedSql({ "from public.tenants t": [tenantRow] });
    const vars = await buildWebCallDynamicVariables({ sql, logger, now: NOW, tenantId: "t1" });
    expect(vars).toMatchObject({
      business_name: "Bright Smile Dental",
      assistant_name: "Maya",
      timezone: "America/New_York",
      current_date: "2026-10-01",
      current_weekday: "Thursday",
      disclosure_line: "You are speaking with an AI assistant. This call is recorded.",
      is_manual_mode: "false",
      language: "en",
      caller_greeting: "",
      caller_name_on_file: "",
      caller_phone_on_file: "",
    });
    expect(vars?.["upcoming_weekday_dates"]).toBeTruthy();
    expect(vars?.["greeting_hours_context"]).toBeTruthy();
    expect(vars?.["caller_recent_context"]).toContain("No caller ID");
    expect(Object.values(vars ?? {}).every((v) => typeof v === "string")).toBe(true);
    // No caller number, so no customer lookup.
    expect(calls.some((c) => c.text.includes("from public.customers"))).toBe(false);
  });

  it("uses the default disclosure line when the template has none", async () => {
    const { sql } = makeRoutedSql({
      "from public.tenants t": [{ ...tenantRow, disclosure_line: null }],
    });
    const vars = await buildWebCallDynamicVariables({ sql, logger, now: NOW, tenantId: "t1" });
    expect(vars?.["disclosure_line"]).toBe(DEFAULT_DISCLOSURE_LINE);
  });

  it("returns null when the tenant is missing", async () => {
    const { sql } = makeRoutedSql({});
    expect(await buildWebCallDynamicVariables({ sql, logger, now: NOW, tenantId: "t1" })).toBe(
      null,
    );
  });
});

describe("resolveWebCallDynamicVariables", () => {
  const base = { logger, now: NOW, tenantId: "t1", logPrefix: "test" };

  it("returns the full set when it builds", async () => {
    const { sql } = makeRoutedSql({ "from public.tenants t": [tenantRow] });
    const vars = await resolveWebCallDynamicVariables({
      ...base,
      sql,
      fallbackDisclosureLine: "fallback",
    });
    expect(vars?.["current_date"]).toBe("2026-10-01");
    expect(vars?.["disclosure_line"]).toBe(tenantRow.disclosure_line);
  });

  it("falls back to the disclosure line alone when the build throws", async () => {
    const { sql } = makeRoutedSql({ "from public.tenants t": new Error("db down") });
    const vars = await resolveWebCallDynamicVariables({
      ...base,
      sql,
      fallbackDisclosureLine: "fallback",
    });
    expect(vars).toEqual({ disclosure_line: "fallback" });
  });

  it("falls back when the tenant row is missing, and sends nothing without a disclosure line", async () => {
    const { sql } = makeRoutedSql({});
    expect(
      await resolveWebCallDynamicVariables({ ...base, sql, fallbackDisclosureLine: "fallback" }),
    ).toEqual({ disclosure_line: "fallback" });
    expect(
      await resolveWebCallDynamicVariables({ ...base, sql, fallbackDisclosureLine: null }),
    ).toBeUndefined();
  });
});
