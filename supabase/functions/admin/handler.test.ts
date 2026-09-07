import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.js";
import type { SqlClient } from "../_shared/types.js";
import type { AdminRequestContext } from "./handler.js";
import { routeAdminRequest } from "./handler.js";

const logger = createLogger();

function baseCtx(overrides: Partial<AdminRequestContext> = {}): AdminRequestContext {
  return {
    method: "GET",
    path: "/admin-tenants",
    claims: { app_metadata: { platform_admin: true } },
    body: undefined,
    adminUserId: "admin_1",
    ...overrides,
  };
}

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

describe("routeAdminRequest — auth gate", () => {
  it("rejects any request without platform_admin=true, before routing", async () => {
    const { sql } = makeSql();
    const result = await routeAdminRequest(
      sql,
      baseCtx({ claims: { app_metadata: { platform_admin: false } } }),
      logger,
    );
    expect(result).toEqual({ status: 403, body: { error: "not_a_platform_admin" } });
  });

  it("rejects a request with no claims at all", async () => {
    const { sql } = makeSql();
    const result = await routeAdminRequest(sql, baseCtx({ claims: null }), logger);
    expect(result.status).toBe(403);
  });
});

describe("routeAdminRequest — tenants group", () => {
  it("lists tenants on GET /admin-tenants", async () => {
    const { sql } = makeSql({
      "from public.tenants where deleted_at": [
        { id: "t1", name: "Acme", vertical: "auto", status: "active" },
      ],
    });
    const result = await routeAdminRequest(sql, baseCtx(), logger);
    expect(result.status).toBe(200);
    expect((result.body as { tenants: unknown[] }).tenants).toHaveLength(1);
  });

  it("patches allowed fields and writes an admin_actions audit row", async () => {
    const { sql, calls } = makeSql({
      "select * from public.tenants where id": [{ id: "t1", status: "trialing" }],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({ method: "PATCH", path: "/admin-tenants/t1", body: { status: "active" } }),
      logger,
    );
    expect(result.status).toBe(200);
    expect(calls.some((c) => c.text.includes("insert into public.admin_actions"))).toBe(true);
  });

  it("rejects an unrecognized PATCH field (never silently no-ops, returns 422)", async () => {
    const { sql } = makeSql({ "select * from public.tenants where id": [{ id: "t1" }] });
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "PATCH",
        path: "/admin-tenants/t1",
        body: { stripe_customer_id: "cus_hacked" },
      }),
      logger,
    );
    expect(result.status).toBe(422);
  });

  it("requires AAL2 for impersonation and never reaches the audit-log write without it", async () => {
    const { sql, calls } = makeSql();
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-tenants/t1/impersonate",
        claims: { app_metadata: { platform_admin: true }, aal: "aal1" },
      }),
      logger,
    );
    expect(result).toEqual({ status: 403, body: { error: "aal2_required" } });
    expect(calls.some((c) => c.text.includes("insert into public.admin_actions"))).toBe(false);
  });

  it("writes admin_actions impersonate_start when AAL2 is present, and returns 501 without supabaseAdmin deps", async () => {
    const { sql, calls } = makeSql({ "from public.tenants where id": [{ id: "t1" }] });
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-tenants/t1/impersonate",
        claims: { app_metadata: { platform_admin: true }, aal: "aal2" },
      }),
      logger,
    );
    expect(calls.some((c) => c.text.includes("insert into public.admin_actions"))).toBe(true);
    // Token minting itself needs deps.supabaseAdmin wired at deploy time.
    expect(result.status).toBe(501);
  });

  it("mints a real impersonation link when supabaseAdmin deps are wired", async () => {
    const { sql } = makeSql({
      "from public.tenants where id": [{ id: "t1" }],
      "from public.memberships where tenant_id": [{ user_id: "owner-1" }],
    });
    const fetchImpl = (async (url: string) => {
      if (url.includes("/admin/users/")) {
        return new Response(JSON.stringify({ email: "owner@example.com" }), { status: 200 });
      }
      return new Response(JSON.stringify({ action_link: "https://project.supabase.co/magic" }), {
        status: 200,
      });
    }) as never;
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-tenants/t1/impersonate",
        claims: { app_metadata: { platform_admin: true }, aal: "aal2" },
      }),
      logger,
      { supabaseAdmin: { fetchImpl, url: "https://project.supabase.co", serviceRoleKey: "sk" } },
    );
    expect(result).toEqual({
      status: 200,
      body: { impersonation_link: "https://project.supabase.co/magic", tenant_id: "t1" },
    });
  });
});

describe("routeAdminRequest — cockpit group", () => {
  it("returns the aggregate waterfall from v_tenant_margin", async () => {
    const { sql } = makeSql({
      "from public.v_tenant_margin": [
        { revenue_cents: 50000, cost_cents: 10000, margin_cents: 40000 },
      ],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({ path: "/admin-cockpit/waterfall" }),
      logger,
    );
    expect(result).toEqual({
      status: 200,
      body: { waterfall: { revenue_cents: 50000, cost_cents: 10000, margin_cents: 40000 } },
    });
  });

  it("returns per-call cost rows", async () => {
    const { sql } = makeSql({
      "from public.v_call_cost_vs_billed": [{ call_id: "c1", provider_cost_cents: 100 }],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({ path: "/admin-cockpit/per-call-cost" }),
      logger,
    );
    expect(result.status).toBe(200);
    expect((result.body as { calls: unknown[] }).calls).toHaveLength(1);
  });

  it("returns tool_health-derived bottleneck rows", async () => {
    const { sql } = makeSql({
      "from public.tool_health": [
        { tool_name: "create_booking", calls: 10, error_rate: 0.1, p95_ms: 400 },
      ],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({ path: "/admin-cockpit/bottleneck" }),
      logger,
    );
    expect(result.status).toBe(200);
    expect((result.body as { tools: unknown[] }).tools).toHaveLength(1);
  });

  it("returns 404 for an unknown cockpit page", async () => {
    const { sql } = makeSql();
    const result = await routeAdminRequest(
      sql,
      baseCtx({ path: "/admin-cockpit/nonexistent" }),
      logger,
    );
    expect(result.status).toBe(404);
  });
});

describe("routeAdminRequest — config-lab group", () => {
  it("projects current vs simulated margin for a price-card override", async () => {
    const { sql } = makeSql({
      "from public.platform_settings where key": [
        { value: { base_cents: 29900, included_minutes: 300, overage_cents: 35 } },
      ],
      "from public.tenants t": [{ tenant_id: "t1", billable_minutes: 400 }],
      "from public.cost_events ce": [{ cost_cents: 5000 }],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-config-lab/simulate",
        body: { vertical: "auto", overage_cents: 50 },
      }),
      logger,
    );
    expect(result.status).toBe(200);
    const body = result.body as {
      current: { revenue_cents: number };
      simulated: { revenue_cents: number };
    };
    // current: 29900 + (400-300)*35 = 33400; simulated: 29900 + (100)*50 = 34900
    expect(body.current.revenue_cents).toBe(33400);
    expect(body.simulated.revenue_cents).toBe(34900);
  });

  it("returns 422 when vertical is missing from the body", async () => {
    const { sql } = makeSql();
    const result = await routeAdminRequest(
      sql,
      baseCtx({ method: "POST", path: "/admin-config-lab/simulate", body: {} }),
      logger,
    );
    expect(result.status).toBe(422);
  });
});

describe("routeAdminRequest — referrals group", () => {
  it("lists referral P&L per partner", async () => {
    const { sql } = makeSql({
      "from public.v_referral_pnl": [
        { referral_partner_id: "p1", name: "Alice", accrued_cents: 1000 },
      ],
    });
    const result = await routeAdminRequest(sql, baseCtx({ path: "/admin-referrals" }), logger);
    expect(result.status).toBe(200);
  });

  it("overrides an accrued commission event's amount and audits it", async () => {
    const { sql, calls } = makeSql({
      "from public.commission_events where id": [
        { id: "ce1", status: "accrued", amount_cents: 20000 },
      ],
      "set amount_cents": [{ id: "ce1", status: "accrued", amount_cents: 15000 }],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-referrals/ce1/payout-override",
        body: { amount_cents: 15000 },
      }),
      logger,
    );
    expect(result.status).toBe(200);
    expect(calls.some((c) => c.text.includes("insert into public.admin_actions"))).toBe(true);
  });

  it("refuses to override a commission that's already batched", async () => {
    const { sql } = makeSql({
      "from public.commission_events where id": [{ id: "ce1", status: "batched" }],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-referrals/ce1/payout-override",
        body: { amount_cents: 15000 },
      }),
      logger,
    );
    expect(result.status).toBe(409);
  });
});

describe("routeAdminRequest — cac group", () => {
  it("returns per-channel CAC", async () => {
    const { sql } = makeSql({
      "from public.cac_events": [
        { channel: "referral", total_cost_cents: 20000, lead_count: 2, converted_tenant_count: 2 },
      ],
    });
    const result = await routeAdminRequest(sql, baseCtx({ path: "/admin-cac" }), logger);
    expect(result.status).toBe(200);
    const body = result.body as { channels: Array<{ cac_cents: number | null }> };
    expect(body.channels[0]?.cac_cents).toBe(10000);
  });
});

describe("routeAdminRequest — templates group", () => {
  const templateRow = {
    id: "tpl1",
    vertical: "auto",
    version: 1,
    compile_target: "conversation_flow",
    system_prompt: "help callers",
    states: [{ id: "greet", name: "Greet", prompt_fragment: "Hi", allowed_tools: [] }],
    transitions: [],
    global_intents: [],
    tools: [],
    voice_id: "voice_1",
    model: "gpt",
    disclosure_line: "This call may be recorded and you are speaking with an AI assistant.",
    is_active: false,
  };

  it("lists templates", async () => {
    const { sql } = makeSql({ "from public.agent_templates order by": [templateRow] });
    const result = await routeAdminRequest(sql, baseCtx({ path: "/admin-templates" }), logger);
    expect(result.status).toBe(200);
  });

  it("returns 501 for publish when Retell deps aren't configured", async () => {
    const { sql } = makeSql({ "from public.agent_templates where id": [templateRow] });
    const result = await routeAdminRequest(
      sql,
      baseCtx({ method: "POST", path: "/admin-templates/tpl1/publish" }),
      logger,
    );
    expect(result.status).toBe(501);
  });

  it("refuses to publish when the compiled output fails the disclosure gate", async () => {
    const { sql } = makeSql({
      "from public.agent_templates where id": [{ ...templateRow, disclosure_line: "" }],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({ method: "POST", path: "/admin-templates/tpl1/publish" }),
      logger,
      {
        retell: {
          fetchImpl: (async () => new Response("{}")) as never,
          apiKey: "key",
          toolWebhookUrl: "https://x/voice-tools",
        },
      },
    );
    expect(result).toEqual({ status: 422, body: { error: "disclosure_gate_failed" } });
  });

  it("publishes end to end: compiles, creates the flow + agent, publishes, and flips is_active", async () => {
    const { sql, calls } = makeSql({ "from public.agent_templates where id": [templateRow] });
    let callIndex = 0;
    const fetchImpl = (async (url: string) => {
      callIndex += 1;
      if (url.includes("create-conversation-flow")) {
        return new Response(JSON.stringify({ conversation_flow_id: "flow_1" }), { status: 201 });
      }
      if (url.includes("create-agent")) {
        return new Response(JSON.stringify({ agent_id: "agent_1" }), { status: 201 });
      }
      if (url.includes("publish-agent-version")) {
        return new Response(JSON.stringify({ agent_id: "agent_1", version: 1 }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as never;
    const result = await routeAdminRequest(
      sql,
      baseCtx({ method: "POST", path: "/admin-templates/tpl1/publish" }),
      logger,
      { retell: { fetchImpl, apiKey: "key", toolWebhookUrl: "https://x/voice-tools" } },
    );
    expect(result).toEqual({
      status: 200,
      body: {
        published: true,
        template_id: "tpl1",
        retell_agent_id: "agent_1",
        retell_flow_id: "flow_1",
      },
    });
    expect(callIndex).toBe(3);
    expect(calls.some((c) => c.text.includes("is_active = true"))).toBe(true);
    expect(calls.some((c) => c.text.includes("insert into public.admin_actions"))).toBe(true);
  });
});

describe("routeAdminRequest — alerts group", () => {
  it("acks an open alert", async () => {
    const { sql } = makeSql({ "update public.alerts": [{ id: "alert_1" }] });
    const result = await routeAdminRequest(
      sql,
      baseCtx({ method: "PATCH", path: "/admin-alerts/alert_1/ack" }),
      logger,
    );
    expect(result).toEqual({ status: 200, body: { acked: true } });
  });

  it("returns 404 when the alert doesn't exist or is already acked", async () => {
    const { sql } = makeSql();
    const result = await routeAdminRequest(
      sql,
      baseCtx({ method: "PATCH", path: "/admin-alerts/missing/ack" }),
      logger,
    );
    expect(result.status).toBe(404);
  });
});

describe("routeAdminRequest — not-yet-implemented groups", () => {
  it("returns 501 (never a silent 200) for an unimplemented endpoint group", async () => {
    const { sql } = makeSql();
    const result = await routeAdminRequest(sql, baseCtx({ path: "/admin-outreach/leads" }), logger);
    expect(result.status).toBe(501);
  });

  it("returns 404 for a genuinely unknown path", async () => {
    const { sql } = makeSql();
    const result = await routeAdminRequest(sql, baseCtx({ path: "/admin-nonexistent" }), logger);
    expect(result.status).toBe(404);
  });
});
