import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import { handleTenantTestCall } from "./handler.ts";

const logger = createLogger();

function makeSql(rows: unknown[]): SqlClient {
  return (() => Promise.resolve(rows)) as SqlClient;
}

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
