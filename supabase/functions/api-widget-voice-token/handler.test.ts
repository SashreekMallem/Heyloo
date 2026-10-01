import { describe, expect, it } from "vitest";
import { hmacSha256Hex } from "../_shared/crypto.ts";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import { VERTICAL_DEFAULTS } from "../_shared/vertical-defaults.ts";
import { handleWidgetVoiceToken } from "./handler.ts";

const logger = createLogger();
const SECRET = "test-widget-token-secret";

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

async function makeToken(
  payload: { tenant_id: string; widget_public_key: string; origin: string },
  opts: { expiresInSeconds?: number; secret?: string; issuedAt?: Date } = {},
): Promise<string> {
  const iat = Math.floor((opts.issuedAt ?? new Date()).getTime() / 1000);
  const exp = iat + (opts.expiresInSeconds ?? 900);
  const full = { ...payload, iat, exp };
  const payloadB64 = btoa(JSON.stringify(full))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const signature = await hmacSha256Hex(opts.secret ?? SECRET, payloadB64);
  return `${payloadB64}.${signature}`;
}

describe("handleWidgetVoiceToken", () => {
  it("rejects a malformed token", async () => {
    const result = await handleWidgetVoiceToken(makeSql([]), "not-a-token", {
      retellFetch: async () => new Response("{}"),
      retellApiKey: "k",
      widgetTokenSecret: SECRET,
      logger,
    });
    expect(result).toEqual({ status: 403, body: { error: "malformed_widget_token" } });
  });

  it("rejects a token signed with the wrong secret", async () => {
    const token = await makeToken(
      { tenant_id: "t1", widget_public_key: "pk", origin: "https://x.example" },
      { secret: "wrong" },
    );
    const result = await handleWidgetVoiceToken(makeSql([]), token, {
      retellFetch: async () => new Response("{}"),
      retellApiKey: "k",
      widgetTokenSecret: SECRET,
      logger,
    });
    expect(result).toEqual({ status: 403, body: { error: "bad_signature_widget_token" } });
  });

  it("rejects an expired token", async () => {
    const token = await makeToken(
      { tenant_id: "t1", widget_public_key: "pk", origin: "https://x.example" },
      { expiresInSeconds: -10 },
    );
    const result = await handleWidgetVoiceToken(makeSql([]), token, {
      retellFetch: async () => new Response("{}"),
      retellApiKey: "k",
      widgetTokenSecret: SECRET,
      logger,
    });
    expect(result).toEqual({ status: 401, body: { error: "expired_widget_token" } });
  });

  it("rejects when the tenant's widget is disabled or the public key no longer matches", async () => {
    const token = await makeToken({
      tenant_id: "t1",
      widget_public_key: "pk",
      origin: "https://x.example",
    });
    const sql = makeSql([
      {
        widget_enabled: false,
        widget_public_key: "pk",
        retell_agent_id: "agent_1",
        disclosure_line: null,
      },
    ]);
    const result = await handleWidgetVoiceToken(sql, token, {
      retellFetch: async () => new Response("{}"),
      retellApiKey: "k",
      widgetTokenSecret: SECRET,
      logger,
    });
    expect(result).toEqual({ status: 403, body: { error: "widget_voice_disabled" } });
  });

  it("rejects when widget_public_key was rotated since the token was minted", async () => {
    const token = await makeToken({
      tenant_id: "t1",
      widget_public_key: "pk_old",
      origin: "https://x.example",
    });
    const sql = makeSql([
      {
        widget_enabled: true,
        widget_public_key: "pk_new",
        retell_agent_id: "agent_1",
        disclosure_line: null,
      },
    ]);
    const result = await handleWidgetVoiceToken(sql, token, {
      retellFetch: async () => new Response("{}"),
      retellApiKey: "k",
      widgetTokenSecret: SECRET,
      logger,
    });
    expect(result).toEqual({ status: 403, body: { error: "widget_voice_disabled" } });
  });

  it("404s when the tenant has no published agent", async () => {
    const token = await makeToken({
      tenant_id: "t1",
      widget_public_key: "pk",
      origin: "https://x.example",
    });
    const sql = makeSql([
      {
        widget_enabled: true,
        widget_public_key: "pk",
        retell_agent_id: null,
        disclosure_line: null,
      },
    ]);
    const result = await handleWidgetVoiceToken(sql, token, {
      retellFetch: async () => new Response("{}"),
      retellApiKey: "k",
      widgetTokenSecret: SECRET,
      logger,
    });
    expect(result).toEqual({ status: 404, body: { error: "agent_not_published" } });
  });

  it("returns access_token + call_id on a successful web call", async () => {
    const token = await makeToken({
      tenant_id: "t1",
      widget_public_key: "pk",
      origin: "https://x.example",
    });
    const sql = makeSql([
      {
        widget_enabled: true,
        widget_public_key: "pk",
        retell_agent_id: "agent_1",
        disclosure_line: "This call may be recorded by AI.",
      },
    ]);
    let capturedBody: unknown;
    const result = await handleWidgetVoiceToken(sql, token, {
      retellFetch: async (_url: string, init?: RequestInit) => {
        capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
        return new Response(JSON.stringify({ access_token: "tok_abc", call_id: "call_abc" }), {
          status: 201,
        });
      },
      retellApiKey: "k",
      widgetTokenSecret: SECRET,
      logger,
    });
    expect(result).toEqual({ status: 200, body: { access_token: "tok_abc", call_id: "call_abc" } });
    expect(capturedBody).toMatchObject({
      agent_id: "agent_1",
      retell_llm_dynamic_variables: { disclosure_line: "This call may be recorded by AI." },
    });
  });

  describe("per-call dynamic variables (a web call never runs /voice-inbound)", () => {
    const widgetRow = {
      widget_enabled: true,
      widget_public_key: "pk",
      retell_agent_id: "agent_1",
      disclosure_line: "This call may be recorded by AI.",
    };

    async function run(webCallRows: unknown[] | Error) {
      const token = await makeToken(
        { tenant_id: "t1", widget_public_key: "pk", origin: "https://x.example" },
        { issuedAt: NOW },
      );
      let capturedBody: Record<string, unknown> | undefined;
      const result = await handleWidgetVoiceToken(makeSql([widgetRow], webCallRows), token, {
        retellFetch: async (_url: string, init?: RequestInit) => {
          capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
          return new Response(JSON.stringify({ access_token: "tok", call_id: "call" }), {
            status: 201,
          });
        },
        retellApiKey: "k",
        widgetTokenSecret: SECRET,
        logger,
        now: () => NOW,
      });
      return { result, vars: capturedBody?.["retell_llm_dynamic_variables"] };
    }

    it("sends the same variables a phone call gets, for the token's tenant", async () => {
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

  describe("origin binding (QA-1 BE-16)", () => {
    const enabledSql = () =>
      makeSql([
        {
          widget_enabled: true,
          widget_public_key: "pk",
          retell_agent_id: "agent_1",
          disclosure_line: null,
        },
      ]);
    const okRetell = async () =>
      new Response(JSON.stringify({ access_token: "tok", call_id: "call" }), { status: 201 });

    it("refuses a token presented from a different origin than the one it was minted for, before touching Retell", async () => {
      const token = await makeToken({
        tenant_id: "t1",
        widget_public_key: "pk",
        origin: "https://x.example",
      });
      let retellCalls = 0;
      const result = await handleWidgetVoiceToken(enabledSql(), token, {
        retellFetch: async () => {
          retellCalls += 1;
          return okRetell();
        },
        retellApiKey: "k",
        widgetTokenSecret: SECRET,
        logger,
        requestOrigin: "https://evil.example",
      });
      expect(result).toEqual({ status: 403, body: { error: "origin_mismatch" } });
      expect(retellCalls).toBe(0);
    });

    it("accepts the token from its own origin", async () => {
      const token = await makeToken({
        tenant_id: "t1",
        widget_public_key: "pk",
        origin: "https://x.example",
      });
      const result = await handleWidgetVoiceToken(enabledSql(), token, {
        retellFetch: okRetell,
        retellApiKey: "k",
        widgetTokenSecret: SECRET,
        logger,
        requestOrigin: "https://x.example",
      });
      expect(result.status).toBe(200);
    });

    it("does not refuse a non-browser caller that sends no Origin", async () => {
      const token = await makeToken({
        tenant_id: "t1",
        widget_public_key: "pk",
        origin: "https://x.example",
      });
      const result = await handleWidgetVoiceToken(enabledSql(), token, {
        retellFetch: okRetell,
        retellApiKey: "k",
        widgetTokenSecret: SECRET,
        logger,
        requestOrigin: null,
      });
      expect(result.status).toBe(200);
    });
  });

  it("502s when Retell refuses/errors the web call", async () => {
    const token = await makeToken({
      tenant_id: "t1",
      widget_public_key: "pk",
      origin: "https://x.example",
    });
    const sql = makeSql([
      {
        widget_enabled: true,
        widget_public_key: "pk",
        retell_agent_id: "agent_1",
        disclosure_line: null,
      },
    ]);
    const result = await handleWidgetVoiceToken(sql, token, {
      retellFetch: async () => new Response("{}", { status: 500 }),
      retellApiKey: "k",
      widgetTokenSecret: SECRET,
      logger,
    });
    expect(result).toEqual({ status: 502, body: { error: "call_token_unavailable" } });
  });
});
