import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import { attachRetellNumber, validateRequest } from "./handler.ts";

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("validateRequest", () => {
  it("accepts tenant_id alone", () => {
    expect(validateRequest({ tenant_id: "t1" })).toEqual({ ok: true, data: { tenant_id: "t1" } });
  });

  it("rejects a missing tenant_id", () => {
    expect(validateRequest({})).toEqual({ ok: false, error: "invalid_tenant_id" });
  });
});

describe("attachRetellNumber", () => {
  it("returns 422 when the tenant has no compiled agent yet", async () => {
    const { sql } = makeSql({ "from public.agent_configs": [] });
    const result = await attachRetellNumber(
      sql,
      { tenant_id: "t1" },
      {
        retellFetch: async () => {
          throw new Error("should never call Retell");
        },
        retellApiKey: "key",
        inboundWebhookUrl: "https://example.com/voice-inbound",
        logger,
      },
    );
    expect(result).toEqual({ status: 422, body: { error: "tenant_has_no_agent" } });
  });

  it("picks the single account number when phone_e164 is omitted, updates it, and upserts phone_numbers", async () => {
    const { sql, calls } = makeSql({
      "from public.agent_configs": [{ retell_agent_id: "agent_1" }],
    });
    let updateBody: unknown;
    const retellFetch = async (url: string, init?: RequestInit) => {
      if (url.includes("/v2/list-phone-numbers")) {
        return jsonResponse({ items: [{ phone_number: "+14155551234" }], has_more: false });
      }
      if (url.includes("/update-phone-number/")) {
        updateBody = init?.body ? JSON.parse(init.body as string) : undefined;
        return jsonResponse({ phone_number: "+14155551234" });
      }
      throw new Error(`unexpected call: ${url}`);
    };

    const result = await attachRetellNumber(
      sql,
      { tenant_id: "t1" },
      {
        retellFetch,
        retellApiKey: "key",
        inboundWebhookUrl: "https://example.com/voice-inbound",
        logger,
      },
    );

    expect(result).toEqual({ status: 200, body: { phone_e164: "+14155551234" } });
    expect(updateBody).toEqual({
      inbound_agents: [{ agent_id: "agent_1", weight: 1 }],
      inbound_webhook_url: "https://example.com/voice-inbound",
    });
    const upsert = calls.find((c) => c.text.includes("into public.phone_numbers"));
    expect(upsert).toBeDefined();
    expect(upsert?.values).toContain("t1");
    expect(upsert?.values).toContain("+14155551234");
  });

  it("selects the requested phone_e164 when multiple numbers exist", async () => {
    const { sql } = makeSql({ "from public.agent_configs": [{ retell_agent_id: "agent_1" }] });
    const retellFetch = async (url: string) => {
      if (url.includes("/v2/list-phone-numbers")) {
        return jsonResponse({
          items: [{ phone_number: "+14155551111" }, { phone_number: "+14155552222" }],
          has_more: false,
        });
      }
      if (url.includes("/update-phone-number/")) {
        return jsonResponse({ phone_number: "+14155552222" });
      }
      throw new Error(`unexpected call: ${url}`);
    };

    const result = await attachRetellNumber(
      sql,
      { tenant_id: "t1", phone_e164: "+14155552222" },
      { retellFetch, retellApiKey: "key", inboundWebhookUrl: "https://example.com", logger },
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ phone_e164: "+14155552222" });
  });

  it("returns 422 when multiple numbers exist and phone_e164 wasn't specified", async () => {
    const { sql } = makeSql({ "from public.agent_configs": [{ retell_agent_id: "agent_1" }] });
    const retellFetch = async (url: string) => {
      if (url.includes("/v2/list-phone-numbers")) {
        return jsonResponse({
          items: [{ phone_number: "+14155551111" }, { phone_number: "+14155552222" }],
          has_more: false,
        });
      }
      throw new Error("should not reach update");
    };

    const result = await attachRetellNumber(
      sql,
      { tenant_id: "t1" },
      { retellFetch, retellApiKey: "key", inboundWebhookUrl: "https://example.com", logger },
    );

    expect(result).toEqual({
      status: 422,
      body: { error: "ambiguous_number_selection_pass_phone_e164" },
    });
  });
});
