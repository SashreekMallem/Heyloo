import { describe, expect, it } from "vitest";
import { sha256Hex } from "../_shared/crypto.ts";
import { createLogger } from "../_shared/logger.ts";
import type { LeadCallbackRequest } from "../_shared/schemas/lead-callback.ts";
import type { SqlClient } from "../_shared/types.ts";
import { handleLeadCallback, resolveTenantFromApiToken } from "./handler.ts";

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

function baseInput(overrides: Partial<LeadCallbackRequest> = {}): LeadCallbackRequest {
  return {
    name: "Jamie Lead",
    phone: "5551234567",
    source: "web_form",
    consent_text: "I agree to be contacted by an AI assistant about this listing.",
    ...overrides,
  };
}

const NOW = new Date("2026-09-10T18:00:00Z"); // daytime UTC, not quiet hours for America/New_York

describe("resolveTenantFromApiToken", () => {
  it("resolves the tenant for a valid, unrevoked token with the leads:write scope", async () => {
    const hash = await sha256Hex("secret-token-1");
    const { sql } = makeSql({
      "from public.api_tokens": [{ id: "tok1", tenant_id: "t1", scopes: ["leads:write"] }],
    });
    const result = await resolveTenantFromApiToken(sql, "secret-token-1");
    expect(result).toEqual({ tenant_id: "t1", api_token_id: "tok1" });
    void hash;
  });

  it("returns null when no token matches", async () => {
    const { sql } = makeSql({ "from public.api_tokens": [] });
    expect(await resolveTenantFromApiToken(sql, "unknown")).toBeNull();
  });

  it("returns null when the token lacks the leads:write scope", async () => {
    const { sql } = makeSql({
      "from public.api_tokens": [{ id: "tok1", tenant_id: "t1", scopes: ["read"] }],
    });
    expect(await resolveTenantFromApiToken(sql, "secret-token-1")).toBeNull();
  });
});

describe("handleLeadCallback", () => {
  it("refuses with invalid_phone before ever writing a row", async () => {
    const { sql, calls } = makeSql();
    const result = await handleLeadCallback(
      sql,
      "t1",
      baseInput({ phone: "123" }),
      { retellFetch: async () => new Response("{}"), retellApiKey: "k", logger },
      NOW,
    );
    expect(result).toEqual({ status: 422, body: { error: "invalid_phone" } });
    expect(calls.length).toBe(0);
  });

  it("returns the existing row (409) on a replayed idempotency_key instead of calling again", async () => {
    const { sql, calls } = makeSql({
      "from public.lead_callback_requests": [{ id: "lcr_existing", status: "called" }],
    });
    const result = await handleLeadCallback(
      sql,
      "t1",
      baseInput({ idempotency_key: "crm-evt-1" }),
      { retellFetch: async () => new Response("{}"), retellApiKey: "k", logger },
      NOW,
    );
    expect(result).toEqual({
      status: 409,
      body: { status: "called", lead_callback_request_id: "lcr_existing" },
    });
    expect(calls.some((c) => c.text.includes("insert into public.lead_callback_requests"))).toBe(
      false,
    );
  });

  it("returns 404 when the tenant does not exist", async () => {
    const { sql } = makeSql({ "from public.tenants t": [] });
    const result = await handleLeadCallback(
      sql,
      "missing-tenant",
      baseInput(),
      { retellFetch: async () => new Response("{}"), retellApiKey: "k", logger },
      NOW,
    );
    expect(result).toEqual({ status: 404, body: { error: "tenant_not_found" } });
  });

  it("marks the lead failed (502) when the tenant has no published agent/number/disclosure line", async () => {
    const { sql, calls } = makeSql({
      "from public.tenants t": [
        {
          timezone: "America/New_York",
          retell_agent_id: null,
          disclosure_line: null,
          from_number: null,
        },
      ],
      "insert into public.lead_callback_requests": [{ id: "lcr_1" }],
    });
    const result = await handleLeadCallback(
      sql,
      "t1",
      baseInput(),
      { retellFetch: async () => new Response("{}"), retellApiKey: "k", logger },
      NOW,
    );
    expect(result).toEqual({
      status: 502,
      body: { error: "tenant_not_configured_for_calling", lead_callback_request_id: "lcr_1" },
    });
    expect(
      calls.some(
        (c) =>
          c.text.includes("update public.lead_callback_requests") &&
          c.text.includes("tenant_not_configured_for_calling"),
      ),
    ).toBe(true);
  });

  it("defers (202) instead of calling during the tenant's quiet hours", async () => {
    const quietNow = new Date("2026-09-10T04:00:00Z"); // ~midnight America/New_York
    const { sql, calls } = makeSql({
      "from public.tenants t": [
        {
          timezone: "America/New_York",
          retell_agent_id: "agent_1",
          disclosure_line: "This call may be recorded by AI.",
          from_number: "+15559998888",
        },
      ],
      "insert into public.lead_callback_requests": [{ id: "lcr_1" }],
    });
    const result = await handleLeadCallback(
      sql,
      "t1",
      baseInput(),
      { retellFetch: async () => new Response("{}"), retellApiKey: "k", logger },
      quietNow,
    );
    expect(result.status).toBe(202);
    expect((result.body as { status: string }).status).toBe("deferred_quiet_hours");
    expect(
      calls.some(
        (c) =>
          c.text.includes("update public.lead_callback_requests") &&
          c.text.includes("deferred_quiet_hours"),
      ),
    ).toBe(true);
  });

  it("places the outbound call, writes an outbound call_logs row, and marks the lead 'called'", async () => {
    const { sql, calls } = makeSql({
      "from public.tenants t": [
        {
          timezone: "America/New_York",
          retell_agent_id: "agent_1",
          disclosure_line: "This call may be recorded by AI.",
          from_number: "+15559998888",
        },
      ],
      "insert into public.lead_callback_requests": [{ id: "lcr_1" }],
      "from public.phone_numbers where e164": [{ id: "pn_1" }],
      "insert into public.call_logs": [{ id: "call_log_1" }],
    });

    let capturedBody: unknown;
    const result = await handleLeadCallback(
      sql,
      "t1",
      baseInput(),
      {
        retellFetch: async (_url: string, init?: RequestInit) => {
          capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
          return new Response(JSON.stringify({ call_id: "call_abc" }), { status: 201 });
        },
        retellApiKey: "k",
        logger,
      },
      NOW,
    );

    expect(result).toEqual({
      status: 200,
      body: { status: "called", lead_callback_request_id: "lcr_1", call_id: "call_abc" },
    });

    expect(capturedBody).toMatchObject({
      from_number: "+15559998888",
      to_number: "+15551234567",
      override_agent_id: "agent_1",
      retell_llm_dynamic_variables: {
        disclosure_line: "This call may be recorded by AI.",
        lead_name: "Jamie Lead",
      },
      metadata: { consent_ref: "lcr_1", lead_callback_request_id: "lcr_1" },
    });

    const callLogInsert = calls.find((c) => c.text.includes("insert into public.call_logs"));
    expect(callLogInsert?.text).toContain("'outbound'");
    expect(callLogInsert?.values).toContain("+15551234567");

    const finalUpdate = calls.find(
      (c) => c.text.includes("update public.lead_callback_requests") && c.text.includes("'called'"),
    );
    expect(finalUpdate?.values).toContain("call_abc");
  });

  it("marks the lead failed (502) when Retell refuses/errors the call", async () => {
    const { sql, calls } = makeSql({
      "from public.tenants t": [
        {
          timezone: "America/New_York",
          retell_agent_id: "agent_1",
          disclosure_line: "This call may be recorded by AI.",
          from_number: "+15559998888",
        },
      ],
      "insert into public.lead_callback_requests": [{ id: "lcr_1" }],
    });
    const result = await handleLeadCallback(
      sql,
      "t1",
      baseInput(),
      {
        retellFetch: async () => new Response(JSON.stringify({ error: "bad" }), { status: 400 }),
        retellApiKey: "k",
        logger,
      },
      NOW,
    );
    expect(result).toEqual({
      status: 502,
      body: { error: "outbound_call_failed", lead_callback_request_id: "lcr_1" },
    });
    expect(
      calls.some(
        (c) =>
          c.text.includes("update public.lead_callback_requests") &&
          c.text.includes("outbound_call_failed"),
      ),
    ).toBe(true);
  });
});
