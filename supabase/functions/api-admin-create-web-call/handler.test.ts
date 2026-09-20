import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import { handleCreateWebCall } from "./handler.ts";

const logger = createLogger();

function makeSql(rows: unknown[]): SqlClient {
  return (() => Promise.resolve(rows)) as SqlClient;
}

describe("handleCreateWebCall", () => {
  it("rejects a missing tenant_id", async () => {
    const result = await handleCreateWebCall(
      makeSql([]),
      {},
      {
        retellFetch: async () => {
          throw new Error("should not be called");
        },
        retellApiKey: "key",
        logger,
      },
    );
    expect(result).toEqual({ status: 422, body: { error: "invalid_tenant_id" } });
  });

  it("404s when the tenant has no published agent", async () => {
    const sql = makeSql([{ retell_agent_id: null, disclosure_line: null }]);
    const result = await handleCreateWebCall(
      sql,
      { tenant_id: "t1" },
      {
        retellFetch: async () => {
          throw new Error("should not be called");
        },
        retellApiKey: "key",
        logger,
      },
    );
    expect(result).toEqual({ status: 404, body: { error: "agent_not_published" } });
  });

  it("returns access_token + call_id + agent_id on a successful web call", async () => {
    const sql = makeSql([
      { retell_agent_id: "agent_1", disclosure_line: "This call may be recorded by AI." },
    ]);
    let capturedBody: unknown;
    const result = await handleCreateWebCall(
      sql,
      { tenant_id: "t1" },
      {
        retellFetch: async (_url: string, init?: RequestInit) => {
          capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
          return new Response(JSON.stringify({ access_token: "tok_abc", call_id: "call_abc" }), {
            status: 201,
          });
        },
        retellApiKey: "key",
        logger,
      },
    );
    expect(result).toEqual({
      status: 200,
      body: { access_token: "tok_abc", call_id: "call_abc", agent_id: "agent_1" },
    });
    expect(capturedBody).toMatchObject({
      agent_id: "agent_1",
      retell_llm_dynamic_variables: { disclosure_line: "This call may be recorded by AI." },
    });
  });

  it("502s when Retell refuses/errors the web call", async () => {
    const sql = makeSql([{ retell_agent_id: "agent_1", disclosure_line: null }]);
    const result = await handleCreateWebCall(
      sql,
      { tenant_id: "t1" },
      {
        retellFetch: async () => new Response("{}", { status: 500 }),
        retellApiKey: "key",
        logger,
      },
    );
    expect(result).toEqual({ status: 502, body: { error: "call_token_unavailable" } });
  });
});
