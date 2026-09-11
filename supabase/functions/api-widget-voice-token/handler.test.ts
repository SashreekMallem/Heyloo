import { describe, expect, it } from "vitest";
import { hmacSha256Hex } from "../_shared/crypto.ts";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import { handleWidgetVoiceToken } from "./handler.ts";

const logger = createLogger();
const SECRET = "test-widget-token-secret";

function makeSql(rows: unknown[]): SqlClient {
  return (() => Promise.resolve(rows)) as SqlClient;
}

async function makeToken(
  payload: { tenant_id: string; widget_public_key: string; origin: string },
  opts: { expiresInSeconds?: number; secret?: string } = {},
): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
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
