import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import type { AdminRequestContext } from "./handler.ts";
import { routeAdminRequest } from "./handler.ts";

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

  it("returns { tenant, metrics } on GET /admin-tenants/:id, computing MRR/margin/minutes rather than reading them off `tenants`", async () => {
    const { sql } = makeSql({
      "select * from public.tenants where id": [
        { id: "t1", name: "Acme", vertical: "auto", status: "active" },
      ],
      "from public.v_tenant_margin": [
        { revenue_cents: 20000, cost_cents: 5000, margin_cents: 15000 },
      ],
      "from public.usage_daily": [{ minutes_used: 340 }],
    });
    const result = await routeAdminRequest(sql, baseCtx({ path: "/admin-tenants/t1" }), logger);
    expect(result.status).toBe(200);
    const body = result.body as {
      tenant: { id: string };
      metrics: { mrr_cents: number; margin_pct: number; minutes_used: number };
    };
    expect(body.tenant.id).toBe("t1");
    expect(body.metrics).toEqual({ mrr_cents: 20000, margin_pct: 75, minutes_used: 340 });
  });

  it("GET /admin-tenants/:id returns zeroed metrics (not a crash) when the tenant has no margin/usage rows yet", async () => {
    const { sql } = makeSql({
      "select * from public.tenants where id": [{ id: "t2", name: "New Co", status: "trialing" }],
    });
    const result = await routeAdminRequest(sql, baseCtx({ path: "/admin-tenants/t2" }), logger);
    expect(result.status).toBe(200);
    const body = result.body as { metrics: { mrr_cents: number; margin_pct: number } };
    expect(body.metrics).toEqual({ mrr_cents: 0, margin_pct: 0, minutes_used: 0 });
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
        body: { reason: "customer escalation" },
      }),
      logger,
    );
    expect(result).toEqual({ status: 403, body: { error: "aal2_required" } });
    expect(calls.some((c) => c.text.includes("insert into public.admin_actions"))).toBe(false);
  });

  it("rejects impersonation with no reason (adminImpersonateSchema requires one for the audit log)", async () => {
    const { sql, calls } = makeSql();
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-tenants/t1/impersonate",
        claims: { app_metadata: { platform_admin: true }, aal: "aal2" },
        body: {},
      }),
      logger,
    );
    expect(result).toEqual({ status: 422, body: { error: "reason_required" } });
    expect(calls.some((c) => c.text.includes("insert into public.admin_actions"))).toBe(false);
  });

  it("writes admin_actions impersonate_start (with reason + timebox) when AAL2 is present, and returns 501 without supabaseAdmin deps", async () => {
    const { sql, calls } = makeSql({ "from public.tenants where id": [{ id: "t1" }] });
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-tenants/t1/impersonate",
        claims: { app_metadata: { platform_admin: true }, aal: "aal2" },
        body: { reason: "customer escalation" },
      }),
      logger,
    );
    const auditCall = calls.find((c) => c.text.includes("insert into public.admin_actions"));
    expect(auditCall).toBeDefined();
    expect(JSON.stringify(auditCall?.values)).toContain("customer escalation");
    // Token minting itself needs deps.supabaseAdmin wired at deploy time.
    expect(result.status).toBe(501);
  });

  it("mints a real impersonation link + expires_at when supabaseAdmin deps are wired", async () => {
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
        body: { reason: "customer escalation" },
      }),
      logger,
      { supabaseAdmin: { fetchImpl, url: "https://project.supabase.co", serviceRoleKey: "sk" } },
    );
    expect(result.status).toBe(200);
    const body = result.body as {
      impersonation_link: string;
      tenant_id: string;
      expires_at: string;
    };
    expect(body.impersonation_link).toBe("https://project.supabase.co/magic");
    expect(body.tenant_id).toBe("t1");
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("inserts a read-only impersonation_sessions row (edit_enabled=false) once the mint succeeds", async () => {
    const { sql, calls } = makeSql({
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
    await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-tenants/t1/impersonate",
        claims: { app_metadata: { platform_admin: true }, aal: "aal2" },
        body: { reason: "customer escalation" },
      }),
      logger,
      { supabaseAdmin: { fetchImpl, url: "https://project.supabase.co", serviceRoleKey: "sk" } },
    );
    const insertCall = calls.find((c) =>
      c.text.includes("insert into public.impersonation_sessions"),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall?.values.slice(0, 4)).toEqual([
      "t1",
      "admin_1",
      "owner-1",
      "customer escalation",
    ]);
    expect(insertCall?.values).not.toContain(true);
    expect(new Date(insertCall?.values[4] as string).getTime()).toBeGreaterThan(Date.now());
  });

  it("writes a second admin_actions entry for impersonate-end, and ends any active impersonation_sessions row", async () => {
    const { sql, calls } = makeSql();
    const result = await routeAdminRequest(
      sql,
      baseCtx({ method: "POST", path: "/admin-tenants/t1/impersonate-end" }),
      logger,
    );
    expect(result).toEqual({ status: 200, body: { ended: true } });
    expect(
      calls.some(
        (c) =>
          c.text.includes("insert into public.admin_actions") &&
          JSON.stringify(c.values).includes("impersonate_end"),
      ),
    ).toBe(true);
    expect(
      calls.some(
        (c) =>
          c.text.includes("update public.impersonation_sessions") && c.text.includes("ended_at"),
      ),
    ).toBe(true);
  });

  describe("impersonate edit-mode toggle", () => {
    it("requires AAL2", async () => {
      const { sql, calls } = makeSql();
      const result = await routeAdminRequest(
        sql,
        baseCtx({
          method: "POST",
          path: "/admin-tenants/t1/impersonate/edit-mode",
          claims: { app_metadata: { platform_admin: true }, aal: "aal1" },
          body: { enabled: true },
        }),
        logger,
      );
      expect(result).toEqual({ status: 403, body: { error: "aal2_required" } });
      expect(calls.some((c) => c.text.includes("insert into public.admin_actions"))).toBe(false);
    });

    it("rejects a non-boolean enabled field", async () => {
      const { sql } = makeSql();
      const result = await routeAdminRequest(
        sql,
        baseCtx({
          method: "POST",
          path: "/admin-tenants/t1/impersonate/edit-mode",
          claims: { app_metadata: { platform_admin: true }, aal: "aal2" },
          body: { enabled: "yes" },
        }),
        logger,
      );
      expect(result).toEqual({ status: 422, body: { error: "invalid_enabled" } });
    });

    it("returns 404 when the calling admin has no active impersonation session on this tenant", async () => {
      const { sql } = makeSql();
      const result = await routeAdminRequest(
        sql,
        baseCtx({
          method: "POST",
          path: "/admin-tenants/t1/impersonate/edit-mode",
          claims: { app_metadata: { platform_admin: true }, aal: "aal2" },
          body: { enabled: true },
        }),
        logger,
      );
      expect(result).toEqual({ status: 404, body: { error: "no_active_impersonation_session" } });
    });

    it("flips edit_enabled and writes a second admin_actions audit entry", async () => {
      const { sql, calls } = makeSql({
        "select edit_enabled from public.impersonation_sessions": [{ edit_enabled: false }],
      });
      const result = await routeAdminRequest(
        sql,
        baseCtx({
          method: "POST",
          path: "/admin-tenants/t1/impersonate/edit-mode",
          claims: { app_metadata: { platform_admin: true }, aal: "aal2" },
          body: { enabled: true },
        }),
        logger,
      );
      expect(result).toEqual({ status: 200, body: { edit_enabled: true } });
      expect(
        calls.some((c) => c.text.includes("update public.impersonation_sessions set edit_enabled")),
      ).toBe(true);
      const auditCall = calls.find(
        (c) =>
          c.text.includes("insert into public.admin_actions") &&
          JSON.stringify(c.values).includes("impersonate_edit_mode_change"),
      );
      expect(auditCall).toBeDefined();
    });
  });

  describe("impersonation cookie-fix — impersonated_by claim as alternative actor identity", () => {
    // Simulates the exact failure mode this fixes: `@supabase/ssr`'s
    // one-cookie-per-domain storage means a request that should carry the
    // admin's own session instead carries the TENANT OWNER's session
    // (tenant_id/role claims, no platform_admin) — but still carrying
    // `impersonated_by` since the hook stamps it on every mint/refresh
    // while the impersonation_sessions row is active.
    const impersonatedOwnerClaims = {
      app_metadata: { tenant_id: "t1", role: "owner" as const, impersonated_by: "admin_1" },
    };

    it("the top-level platform_admin gate still rejects a non-self-service route for an impersonated-owner token", async () => {
      const { sql } = makeSql();
      const result = await routeAdminRequest(
        sql,
        baseCtx({
          method: "GET",
          path: "/admin-tenants",
          claims: impersonatedOwnerClaims,
          adminUserId: "owner-1",
        }),
        logger,
      );
      expect(result).toEqual({ status: 403, body: { error: "not_a_platform_admin" } });
    });

    it("ends the real admin's impersonation session using the impersonated_by claim, not the token's own sub", async () => {
      const { sql, calls } = makeSql();
      const result = await routeAdminRequest(
        sql,
        baseCtx({
          method: "POST",
          path: "/admin-tenants/t1/impersonate-end",
          claims: impersonatedOwnerClaims,
          adminUserId: "owner-1",
        }),
        logger,
      );
      expect(result).toEqual({ status: 200, body: { ended: true } });
      const updateCall = calls.find(
        (c) =>
          c.text.includes("update public.impersonation_sessions") && c.text.includes("ended_at"),
      );
      expect(updateCall).toBeDefined();
      expect(updateCall?.values).toContain("admin_1");
      expect(updateCall?.values).not.toContain("owner-1");
      const auditCall = calls.find(
        (c) =>
          c.text.includes("insert into public.admin_actions") &&
          JSON.stringify(c.values).includes("impersonate_end"),
      );
      expect(auditCall).toBeDefined();
      expect(auditCall?.values).toContain("admin_1");
    });

    it("flips edit_enabled via the impersonated_by claim, scoped to the real admin's own session row", async () => {
      const { sql, calls } = makeSql({
        "select edit_enabled from public.impersonation_sessions": [{ edit_enabled: false }],
      });
      const result = await routeAdminRequest(
        sql,
        baseCtx({
          method: "POST",
          path: "/admin-tenants/t1/impersonate/edit-mode",
          claims: impersonatedOwnerClaims,
          adminUserId: "owner-1",
          body: { enabled: true },
        }),
        logger,
      );
      expect(result).toEqual({ status: 200, body: { edit_enabled: true } });
      const updateCall = calls.find((c) =>
        c.text.includes("update public.impersonation_sessions set edit_enabled"),
      );
      expect(updateCall?.values).toContain("admin_1");
      expect(updateCall?.values).not.toContain("owner-1");
    });

    it("rejects edit-mode for a plain tenant owner token carrying no impersonated_by claim", async () => {
      const { sql } = makeSql();
      const result = await routeAdminRequest(
        sql,
        baseCtx({
          method: "POST",
          path: "/admin-tenants/t1/impersonate/edit-mode",
          claims: { app_metadata: { tenant_id: "t1", role: "owner" } },
          adminUserId: "owner-1",
          body: { enabled: true },
        }),
        logger,
      );
      expect(result).toEqual({ status: 403, body: { error: "not_a_platform_admin" } });
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

  // OPS-8 deliverable 3: an admin read of pgmq.metrics_all() so backlog/DLQ
  // depth is visible without a direct DB query.
  it("returns every queue's pgmq.metrics_all() row on GET /admin-cockpit/queues", async () => {
    const { sql } = makeSql({
      "pgmq.metrics_all": [
        {
          queue_name: "recording_fetch_queue",
          queue_length: 5,
          newest_msg_age_sec: 10,
          oldest_msg_age_sec: 45000,
          total_messages: 5,
          queue_visible_length: 5,
        },
        {
          queue_name: "recording_fetch_queue_dlq",
          queue_length: 0,
          newest_msg_age_sec: null,
          oldest_msg_age_sec: null,
          total_messages: 0,
          queue_visible_length: 0,
        },
      ],
    });
    const result = await routeAdminRequest(sql, baseCtx({ path: "/admin-cockpit/queues" }), logger);
    expect(result.status).toBe(200);
    expect((result.body as { queues: unknown[] }).queues).toHaveLength(2);
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
  // `id` is a real uuid here (ADMIN+PREVIEW-R6 / DESIGN-4: agent_templates.id
  // is a uuid primary key, `vertical` a separate text column) — every real
  // caller (cockpit/templates/page.tsx's row-click, the editor's GET, and
  // its "Run publish gate" POST) sends the *vertical slug* as the path's
  // `:key` segment, never this id, so most of the tests below exercise the
  // by-vertical resolution path a bare `where id = $1` query could never
  // satisfy.
  const templateRow = {
    id: "3f6e6b1a-2c1e-4f0a-9b1b-8f2e6b6f2a11",
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

  it("resolves GET /admin-templates/:vertical by vertical slug (not id) — the real caller shape", async () => {
    const { sql, calls } = makeSql({
      "from public.agent_templates where vertical": [templateRow],
    });
    const result = await routeAdminRequest(sql, baseCtx({ path: "/admin-templates/auto" }), logger);
    expect(result).toEqual({ status: 200, body: { template: templateRow } });
    expect(
      calls.some((c) => c.text.includes("where vertical") && !c.text.includes("where id")),
    ).toBe(true);
  });

  it("still resolves GET /admin-templates/:id by id when the key is a real uuid", async () => {
    const { sql, calls } = makeSql({
      "from public.agent_templates where id": [templateRow],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({ path: `/admin-templates/${templateRow.id}` }),
      logger,
    );
    expect(result).toEqual({ status: 200, body: { template: templateRow } });
    expect(calls.some((c) => c.text.includes("where id"))).toBe(true);
  });

  it("404s GET /admin-templates/:vertical for a vertical with no template rows at all", async () => {
    const { sql } = makeSql();
    const result = await routeAdminRequest(
      sql,
      baseCtx({ path: "/admin-templates/nonexistent_vertical" }),
      logger,
    );
    expect(result).toEqual({ status: 404, body: { error: "template_not_found" } });
  });

  it("returns 501 for publish when Retell deps aren't configured", async () => {
    const { sql } = makeSql({ "from public.agent_templates where vertical": [templateRow] });
    const result = await routeAdminRequest(
      sql,
      baseCtx({ method: "POST", path: "/admin-templates/auto/publish" }),
      logger,
    );
    expect(result.status).toBe(501);
  });

  it("refuses to publish when the compiled output fails the disclosure gate", async () => {
    const { sql } = makeSql({
      "from public.agent_templates where vertical": [{ ...templateRow, disclosure_line: "" }],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({ method: "POST", path: "/admin-templates/auto/publish" }),
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

  it("publishes end to end via the vertical slug the UI actually sends: compiles, creates the flow + agent, publishes, and flips is_active by the resolved uuid", async () => {
    const { sql, calls } = makeSql({ "from public.agent_templates where vertical": [templateRow] });
    let callIndex = 0;
    const fetchImpl = (async (url: string) => {
      callIndex += 1;
      if (url.includes("create-conversation-flow")) {
        return new Response(JSON.stringify({ conversation_flow_id: "flow_1" }), { status: 201 });
      }
      if (url.includes("create-agent")) {
        return new Response(JSON.stringify({ agent_id: "agent_1", version: 1 }), { status: 201 });
      }
      if (url.includes("publish-agent-version")) {
        return new Response(JSON.stringify({ agent_id: "agent_1", version: 1 }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as never;
    const result = await routeAdminRequest(
      sql,
      baseCtx({ method: "POST", path: "/admin-templates/auto/publish" }),
      logger,
      { retell: { fetchImpl, apiKey: "key", toolWebhookUrl: "https://x/voice-tools" } },
    );
    expect(result).toEqual({
      status: 200,
      body: {
        published: true,
        template_id: templateRow.id,
        retell_agent_id: "agent_1",
        retell_flow_id: "flow_1",
      },
    });
    expect(callIndex).toBe(3);
    // The two `is_active` flips must key off the *resolved* uuid, never the
    // raw "auto" path segment — this is exactly the bug being guarded.
    expect(
      calls.some((c) => c.text.includes("is_active = true") && c.values.includes(templateRow.id)),
    ).toBe(true);
    expect(calls.some((c) => c.text.includes("insert into public.admin_actions"))).toBe(true);
  });

  // Regression (CALL-3 jsonb double-encoding fix): `POST /admin-templates`
  // and `PATCH /admin-templates/:id` used to write
  // `${JSON.stringify(x)}::jsonb`, which postgres.js (prepare:true) would
  // re-serialize a second time, storing a jsonb *string* instead of an
  // array/object — confirmed live-corrupted on `agent_templates.tools`
  // before the fix. Every jsonb-typed column these routes write must
  // receive the raw object/array as the bound parameter, never a
  // caller-pre-stringified string.
  it("POST /admin-templates binds the raw states/transitions/global_intents/tools objects to their ::jsonb params, never pre-stringified", async () => {
    const { sql, calls } = makeSql({ "insert into public.agent_templates": [{ id: "tmpl_new" }] });
    const states = [{ id: "greet", name: "Greet", prompt_fragment: "Hi", allowed_tools: [] }];
    const transitions = [{ from: "greet", to: "book", on: "book_intent" }];
    const globalIntents = [{ id: "transfer", trigger: "ask for a human" }];
    const tools = [{ type: "custom", name: "lookup_customer" }];
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-templates",
        body: {
          vertical: "auto",
          name: "Auto v2",
          version: 2,
          compile_target: "conversation_flow",
          voice_id: "voice_1",
          model: "gpt",
          disclosure_line: "This call may be recorded and you are speaking with an AI assistant.",
          states,
          transitions,
          global_intents: globalIntents,
          tools,
        },
      }),
      logger,
    );
    expect(result).toEqual({ status: 201, body: { template_id: "tmpl_new" } });
    const insertCall = calls.find((c) => c.text.includes("insert into public.agent_templates"));
    expect(insertCall).toBeDefined();
    for (const jsonbValue of [states, transitions, globalIntents, tools]) {
      const bound = insertCall?.values.find(
        (v) => typeof v !== "string" && JSON.stringify(v) === JSON.stringify(jsonbValue),
      );
      expect(bound).toBeDefined();
      expect(typeof bound).not.toBe("string");
    }
  });

  it("PATCH /admin-templates/:id binds the raw states/transitions/global_intents/tools objects to their ::jsonb params, never pre-stringified", async () => {
    const { sql, calls } = makeSql({
      "select * from public.agent_templates where id": [templateRow],
    });
    const states = [{ id: "greet", name: "Greet", prompt_fragment: "Hi", allowed_tools: [] }];
    const transitions = [{ from: "greet", to: "book", on: "book_intent" }];
    const globalIntents = [{ id: "transfer", trigger: "ask for a human" }];
    const tools = [{ type: "custom", name: "lookup_customer" }];
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "PATCH",
        path: `/admin-templates/${templateRow.id}`,
        body: { states, transitions, global_intents: globalIntents, tools },
      }),
      logger,
    );
    expect(result.status).toBe(200);
    for (const [column, jsonbValue] of [
      ["states", states],
      ["transitions", transitions],
      ["global_intents", globalIntents],
      ["tools", tools],
    ] as const) {
      const updateCall = calls.find((c) => c.text.includes(`set ${column} =`));
      expect(updateCall).toBeDefined();
      const bound = updateCall?.values.find(
        (v) => typeof v !== "string" && JSON.stringify(v) === JSON.stringify(jsonbValue),
      );
      expect(bound).toBeDefined();
      expect(typeof bound).not.toBe("string");
    }
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

// ---------------------------------------------------------------------
// Alert-rule editor (FRONTEND_AUDIT.md M2 — was a `toast("coming soon")`
// stub with no `adminAlertThresholdSchema` persistence anywhere).
// ---------------------------------------------------------------------
describe("routeAdminRequest — alert rules editor", () => {
  it("returns an empty list when no admin_alert_rules row exists yet", async () => {
    const { sql } = makeSql();
    const result = await routeAdminRequest(sql, baseCtx({ path: "/admin-alerts/rules" }), logger);
    expect(result).toEqual({ status: 200, body: { rules: [] } });
  });

  it("returns the stored rules", async () => {
    const { sql } = makeSql({
      "from public.platform_settings where key": [
        {
          value: {
            rules: [
              {
                id: "r1",
                metric: "negative_margin",
                operator: "lt",
                value: 0,
                enabled: true,
                channel: "email",
              },
            ],
          },
        },
      ],
    });
    const result = await routeAdminRequest(sql, baseCtx({ path: "/admin-alerts/rules" }), logger);
    expect(result.status).toBe(200);
    expect((result.body as { rules: unknown[] }).rules).toHaveLength(1);
  });

  it("rejects an invalid new rule (never silently no-ops, returns 422)", async () => {
    const { sql } = makeSql();
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-alerts/rules",
        body: {
          metric: "not_a_real_metric",
          operator: "gt",
          value: 1,
          enabled: true,
          channel: "email",
        },
      }),
      logger,
    );
    expect(result.status).toBe(422);
  });

  it("creates a new rule with a generated id and writes admin_actions", async () => {
    const { sql, calls } = makeSql();
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-alerts/rules",
        body: {
          metric: "usage_spike",
          operator: "gte",
          value: 2,
          enabled: true,
          channel: "dashboard_only",
        },
      }),
      logger,
    );
    expect(result.status).toBe(201);
    const rule = (result.body as { rule: { id: string; metric: string } }).rule;
    expect(rule.metric).toBe("usage_spike");
    expect(rule.id).toBeTruthy();
    expect(
      calls.some(
        (c) =>
          c.text.includes("insert into public.admin_actions") &&
          JSON.stringify(c.values).includes("alert_rule_create"),
      ),
    ).toBe(true);
  });

  it("returns 404 editing a rule id that doesn't exist", async () => {
    const { sql } = makeSql();
    const result = await routeAdminRequest(
      sql,
      baseCtx({ method: "PATCH", path: "/admin-alerts/rules/missing", body: { enabled: false } }),
      logger,
    );
    expect(result.status).toBe(404);
  });

  it("edits an existing rule and writes a before/after admin_actions row", async () => {
    const { sql, calls } = makeSql({
      "from public.platform_settings where key": [
        {
          value: {
            rules: [
              {
                id: "r1",
                metric: "negative_margin",
                operator: "lt",
                value: 0,
                enabled: true,
                channel: "email",
              },
            ],
          },
        },
      ],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "PATCH",
        path: "/admin-alerts/rules/r1",
        body: { enabled: false },
      }),
      logger,
    );
    expect(result.status).toBe(200);
    expect((result.body as { rule: { enabled: boolean } }).rule.enabled).toBe(false);
    expect(
      calls.some(
        (c) =>
          c.text.includes("insert into public.admin_actions") &&
          JSON.stringify(c.values).includes("alert_rule_edit"),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------
// Platform settings (FRONTEND_AUDIT.md H9 — was seeded with invented
// constants, both saves 404'd against endpoints that didn't exist).
// ---------------------------------------------------------------------
describe("routeAdminRequest — platform settings group", () => {
  it("loads the real referral + price-card rows, defaulting unset ones", async () => {
    const { sql } = makeSql({
      "key = any": [
        { key: "referral_flat_amount_cents", value: { amount_cents: 15000 } },
        { key: "referral_qualification_rule", value: { rule: "2nd paid month" } },
        {
          key: "price_card_auto",
          value: { base_cents: 29900, included_minutes: 300, overage_cents: 45 },
        },
      ],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({ path: "/admin-platform-settings" }),
      logger,
    );
    expect(result.status).toBe(200);
    const body = result.body as {
      referral: { flat_amount_cents: number; qualification_rule: string };
      price_cards: Record<string, unknown>;
    };
    expect(body.referral).toEqual({
      flat_amount_cents: 15000,
      qualification_rule: "2nd paid month",
    });
    expect(body.price_cards["auto"]).toEqual({
      base_cents: 29900,
      included_minutes: 300,
      overage_cents: 45,
    });
    expect(body.price_cards["generic"]).toBeNull();
  });

  it("rejects an invalid referral setting (never silently no-ops)", async () => {
    const { sql } = makeSql();
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "PATCH",
        path: "/admin-platform-settings/referral",
        body: { flat_amount_cents: -1, qualification_rule: "" },
      }),
      logger,
    );
    expect(result.status).toBe(422);
  });

  it("saves a valid referral setting and writes a before/after admin_actions row", async () => {
    const { sql, calls } = makeSql();
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "PATCH",
        path: "/admin-platform-settings/referral",
        body: { flat_amount_cents: 20000, qualification_rule: "3rd paid month" },
      }),
      logger,
    );
    expect(result.status).toBe(200);
    expect(
      calls.some(
        (c) =>
          c.text.includes("insert into public.admin_actions") &&
          JSON.stringify(c.values).includes("platform_settings_referral_edit"),
      ),
    ).toBe(true);
  });

  it("rejects an invalid price card (never silently no-ops)", async () => {
    const { sql } = makeSql();
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-platform-settings/pricing",
        body: {
          vertical: "not_a_vertical",
          base_cents: 100,
          included_minutes: 100,
          overage_cents: 10,
          effective_at: new Date().toISOString(),
        },
      }),
      logger,
    );
    expect(result.status).toBe(422);
  });

  it("saves a valid price card update and writes a before/after admin_actions row", async () => {
    const { sql, calls } = makeSql();
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-platform-settings/pricing",
        body: {
          vertical: "auto",
          base_cents: 34900,
          included_minutes: 350,
          overage_cents: 40,
          included_text_conversations: 200,
          text_conversation_overage_cents: 5,
          effective_at: new Date().toISOString(),
        },
      }),
      logger,
    );
    expect(result.status).toBe(200);
    expect((result.body as { vertical: string }).vertical).toBe("auto");
    expect(
      calls.some(
        (c) =>
          c.text.includes("insert into public.admin_actions") &&
          JSON.stringify(c.values).includes("platform_settings_pricing_edit"),
      ),
    ).toBe(true);
  });

  it("merges a pricing save onto the previously-stored value instead of replacing the whole JSONB blob — a field this schema doesn't know about must survive an edit", async () => {
    const { sql, calls } = makeSql({
      "select value from public.platform_settings where key": [
        {
          value: {
            base_cents: 29900,
            included_minutes: 300,
            overage_cents: 35,
            included_text_conversations: 200,
            text_conversation_overage_cents: 5,
            // A field a future migration/seed might add before this admin
            // form is updated to know about it — must not be dropped.
            some_future_field: "keep-me",
          },
        },
      ],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-platform-settings/pricing",
        body: {
          vertical: "auto",
          base_cents: 34900,
          included_minutes: 350,
          overage_cents: 40,
          included_text_conversations: 500,
          text_conversation_overage_cents: 3,
          effective_at: new Date().toISOString(),
        },
      }),
      logger,
    );
    expect(result.status).toBe(200);
    const body = result.body as { price_card: Record<string, unknown> };
    // New/known fields reflect the admin's edit...
    expect(body.price_card).toMatchObject({
      base_cents: 34900,
      included_minutes: 350,
      overage_cents: 40,
      included_text_conversations: 500,
      text_conversation_overage_cents: 3,
    });
    // ...while a field this schema doesn't know about is preserved, not wiped.
    expect(body.price_card["some_future_field"]).toBe("keep-me");

    const insertCall = calls.find((c) => c.text.includes("insert into public.platform_settings"));
    expect(insertCall).toBeDefined();
    // Regression (CALL-3 jsonb double-encoding fix): the `value` parameter
    // bound to the `::jsonb` cast must be the raw object, never a
    // caller-pre-stringified JSON string.
    const writtenValue = insertCall?.values[1] as Record<string, unknown>;
    expect(typeof writtenValue).not.toBe("string");
    expect(writtenValue["some_future_field"]).toBe("keep-me");
    expect(writtenValue["included_text_conversations"]).toBe(500);
  });
});

describe("routeAdminRequest — not-yet-implemented groups", () => {
  it("returns 501 (never a silent 200) for an unimplemented endpoint group", async () => {
    const { sql } = makeSql();
    const result = await routeAdminRequest(sql, baseCtx({ path: "/admin-flags" }), logger);
    expect(result.status).toBe(501);
  });

  it("returns 404 for a genuinely unknown path", async () => {
    const { sql } = makeSql();
    const result = await routeAdminRequest(sql, baseCtx({ path: "/admin-nonexistent" }), logger);
    expect(result.status).toBe(404);
  });
});

// ---------------------------------------------------------------------
// Outreach group (T8 — BACKEND_SPEC §7.7). Was a `501` shell (T3); this
// build completes it.
// ---------------------------------------------------------------------
function jsonRes(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("routeAdminRequest — outreach group", () => {
  it("lists leads, optionally filtered by query params", async () => {
    const { sql, calls } = makeSql({
      "from public.leads": [{ id: "l1", status: "new", vertical: "legal" }],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({ path: "/admin-outreach/leads", query: { status: "new" } }),
      logger,
    );
    expect(result.status).toBe(200);
    expect((result.body as { leads: unknown[] }).leads).toHaveLength(1);
    expect(calls[0]?.values).toContain("new");
  });

  it("OUTREACH-2: sorts leads by phone_complaint_score when sort=score is passed", async () => {
    const { sql, calls } = makeSql({
      "from public.leads": [{ id: "l1", phone_complaint_score: 0.9 }],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({ path: "/admin-outreach/leads", query: { sort: "score" } }),
      logger,
    );
    expect(result.status).toBe(200);
    const call = calls.find((c) => c.text.includes("from public.leads"));
    expect(call?.text).toContain("order by phone_complaint_score desc nulls last");
  });

  it("OUTREACH-2: filters leads by min_score", async () => {
    const { sql, calls } = makeSql({
      "from public.leads": [{ id: "l1", phone_complaint_score: 0.8 }],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({ path: "/admin-outreach/leads", query: { min_score: "0.6" } }),
      logger,
    );
    expect(result.status).toBe(200);
    const call = calls.find((c) => c.text.includes("from public.leads"));
    expect(call?.values).toContain(0.6);
  });

  it("adds a manual suppression entry", async () => {
    const { sql, calls } = makeSql();
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-outreach/suppression",
        body: { contact: "a@example.com" },
      }),
      logger,
    );
    expect(result).toEqual({ status: 200, body: { suppressed: true } });
    expect(calls.some((c) => c.text.includes("insert into public.suppression_list"))).toBe(true);
  });

  it("returns 501 for campaign create when outreach deps aren't configured", async () => {
    const { sql } = makeSql();
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-outreach/campaigns",
        body: { name: "Q1 legal", sender_domain: "mail.heyloo.ai" },
      }),
      logger,
    );
    expect(result.status).toBe(501);
  });

  it("creates a campaign via Smartlead and stores its external id", async () => {
    const { sql, calls } = makeSql({ "insert into public.campaigns": [{ id: "camp_1" }] });
    const fetchImpl = vi.fn(async () => jsonRes({ id: 555 })) as never;
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-outreach/campaigns",
        body: { name: "Q1 legal", sender_domain: "mail.heyloo.ai" },
      }),
      logger,
      {
        outreach: {
          smartleadFetchImpl: fetchImpl,
          smartleadApiKey: "key",
          canSpamFooter: "Acme, 123 Main St",
        },
      },
    );
    expect(result).toEqual({
      status: 201,
      body: { campaign_id: "camp_1", external_campaign_id: "555" },
    });
    expect(calls.some((c) => c.text.includes("insert into public.campaigns"))).toBe(true);
  });

  it("rejects a campaign create for an unsupported provider", async () => {
    const { sql } = makeSql();
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-outreach/campaigns",
        body: { name: "x", sender_domain: "mail.heyloo.ai", provider: "instantly" },
      }),
      logger,
      {
        outreach: {
          smartleadFetchImpl: vi.fn() as never,
          smartleadApiKey: "key",
          canSpamFooter: "footer",
        },
      },
    );
    expect(result).toEqual({ status: 422, body: { error: "unsupported_provider" } });
  });

  it("adds eligible, non-suppressed leads to a campaign and skips the rest", async () => {
    const { sql, calls } = makeSql({
      "from public.campaigns where id": [{ id: "camp1" }],
      "from public.leads where id": [
        { id: "l1", email: "a@example.com", phone: null, status: "new" },
      ],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-outreach/campaigns/camp1/add-leads",
        body: { lead_ids: ["l1"] },
      }),
      logger,
    );
    expect(result).toEqual({
      status: 200,
      body: { added: 1, skipped_suppressed: 0, skipped_not_eligible: 0 },
    });
    expect(calls.some((c) => c.text.includes("insert into public.send_events"))).toBe(true);
  });

  it("skips a suppressed lead on add-leads", async () => {
    const { sql } = makeSql({
      "from public.campaigns where id": [{ id: "camp1" }],
      "from public.leads where id": [
        { id: "l1", email: "a@example.com", phone: null, status: "new" },
      ],
      "from public.suppression_list": [{ id: "s1" }],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-outreach/campaigns/camp1/add-leads",
        body: { lead_ids: ["l1"] },
      }),
      logger,
    );
    expect(result).toEqual({
      status: 200,
      body: { added: 0, skipped_suppressed: 1, skipped_not_eligible: 0 },
    });
  });

  it("returns the reply feed and a funnel summary", async () => {
    const { sql } = makeSql({
      "from public.replies r": [{ id: "r1", body: "interested!", ai_intent: "interested" }],
      "group by status": [{ status: "new", count: 3 }],
      "group by ai_intent": [{ ai_intent: "interested", count: 1 }],
    });
    const repliesResult = await routeAdminRequest(
      sql,
      baseCtx({ path: "/admin-outreach/replies" }),
      logger,
    );
    expect(repliesResult.status).toBe(200);
    const funnelResult = await routeAdminRequest(
      sql,
      baseCtx({ path: "/admin-outreach/funnel" }),
      logger,
    );
    expect(funnelResult.status).toBe(200);
  });

  it("suppresses a lead via the reply one-click action", async () => {
    const { sql, calls } = makeSql({
      "from public.replies where id": [{ id: "reply1", lead_id: "l1" }],
      "from public.leads where id": [
        { id: "l1", email: "a@example.com", phone: null, contact_name: "Jane" },
      ],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-outreach/replies/reply1/actions",
        body: { action: "suppress" },
      }),
      logger,
    );
    expect(result).toEqual({ status: 200, body: { action: "suppress", lead_id: "l1" } });
    expect(calls.some((c) => c.text.includes("insert into public.suppression_list"))).toBe(true);
    expect(calls.some((c) => c.text.includes("status = 'suppressed'"))).toBe(true);
  });

  it("converts a lead via the reply one-click action and closes the CAC loop", async () => {
    const { sql, calls } = makeSql({
      "from public.replies where id": [{ id: "reply1", lead_id: "l1" }],
      "from public.leads where id": [
        { id: "l1", email: "a@example.com", phone: null, contact_name: "Jane" },
      ],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-outreach/replies/reply1/actions",
        body: { action: "convert", tenant_id: "t1" },
      }),
      logger,
    );
    expect(result).toEqual({ status: 200, body: { action: "convert", lead_id: "l1" } });
    expect(calls.some((c) => c.text.includes("converted_tenant_id"))).toBe(true);
    expect(calls.some((c) => c.text.includes("update public.cac_events set tenant_id"))).toBe(true);
  });

  it("returns 501 for mark_interested when resend deps aren't configured", async () => {
    const { sql } = makeSql({
      "from public.replies where id": [{ id: "reply1", lead_id: "l1" }],
      "from public.leads where id": [
        { id: "l1", email: "a@example.com", phone: null, contact_name: "Jane" },
      ],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-outreach/replies/reply1/actions",
        body: { action: "mark_interested" },
      }),
      logger,
    );
    expect(result.status).toBe(501);
  });

  it("sends a demo-followup email via Resend for mark_interested when configured", async () => {
    const { sql, calls } = makeSql({
      "from public.replies where id": [{ id: "reply1", lead_id: "l1" }],
      "from public.leads where id": [
        { id: "l1", email: "a@example.com", phone: null, contact_name: "Jane" },
      ],
    });
    const fetchImpl = vi.fn(async () => jsonRes({ id: "email_1" })) as never;
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-outreach/replies/reply1/actions",
        body: { action: "mark_interested" },
      }),
      logger,
      { resend: { fetchImpl, apiKey: "key", fromAddress: "sales@heyloo.ai" } },
    );
    expect(result).toEqual({ status: 200, body: { action: "mark_interested", lead_id: "l1" } });
    expect(fetchImpl).toHaveBeenCalled();
    expect(calls.some((c) => c.text.includes("status = 'replied'"))).toBe(true);
  });

  it("rolls up CAC per vertical", async () => {
    const { sql } = makeSql({
      "join public.leads l on l.id = ce.lead_id": [
        { vertical: "legal", total_cost_cents: 500, lead_count: 5, converted_tenant_count: 1 },
      ],
    });
    const result = await routeAdminRequest(sql, baseCtx({ path: "/admin-outreach/cac" }), logger);
    expect(result.status).toBe(200);
    const body = result.body as { verticals: { cac_cents: number | null }[] };
    expect(body.verticals[0]?.cac_cents).toBe(500);
  });
});

describe("routeAdminRequest — recurring commission terms (GAP_REGISTER Cluster G item 1)", () => {
  it("PATCHes a partner's rate_bps/commission_base/duration_months and writes an audit entry", async () => {
    const { sql, calls } = makeSql({
      "select id, rate_bps, commission_base, duration_months from public.referral_partners": [
        { id: "p1", rate_bps: null, commission_base: "gross_profit", duration_months: null },
      ],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "PATCH",
        path: "/admin-referrals/partners/p1",
        body: { rate_bps: 1500, commission_base: "revenue", duration_months: 12 },
      }),
      logger,
    );
    expect(result.status).toBe(200);
    expect(
      calls.some(
        (c) =>
          c.text.includes("update public.referral_partners set rate_bps") &&
          c.values.includes(1500),
      ),
    ).toBe(true);
    expect(
      calls.some(
        (c) =>
          c.text.includes("insert into public.admin_actions") &&
          JSON.stringify(c.values).includes("referral_commission_terms_update"),
      ),
    ).toBe(true);
  });

  it("rejects an out-of-range rate_bps", async () => {
    const { sql } = makeSql();
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "PATCH",
        path: "/admin-referrals/partners/p1",
        body: { rate_bps: 20000 },
      }),
      logger,
    );
    expect(result.status).toBe(422);
  });

  it("returns 404 for a non-existent partner", async () => {
    const { sql } = makeSql({
      "select id, rate_bps, commission_base, duration_months from public.referral_partners": [],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "PATCH",
        path: "/admin-referrals/partners/missing",
        body: { rate_bps: 1000 },
      }),
      logger,
    );
    expect(result).toEqual({ status: 404, body: { error: "referral_partner_not_found" } });
  });

  it("upserts a per-vertical override via PUT", async () => {
    const { sql, calls } = makeSql({
      "select id from public.referral_partners": [{ id: "p1" }],
      "insert into public.referral_partner_vertical_overrides": [
        { referral_partner_id: "p1", vertical: "dental", rate_bps: 2500 },
      ],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "PUT",
        path: "/admin-referrals/partners/p1/vertical-overrides/dental",
        body: { rate_bps: 2500 },
      }),
      logger,
    );
    expect(result.status).toBe(200);
    expect(
      calls.some((c) => c.text.includes("on conflict (referral_partner_id, vertical) do update")),
    ).toBe(true);
  });

  it("rejects an unknown vertical on the override route", async () => {
    const { sql } = makeSql({ "select id from public.referral_partners": [{ id: "p1" }] });
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "PUT",
        path: "/admin-referrals/partners/p1/vertical-overrides/not_a_vertical",
        body: { rate_bps: 2500 },
      }),
      logger,
    );
    expect(result).toEqual({ status: 422, body: { error: "invalid_vertical" } });
  });
});

describe("routeAdminRequest — support requests (GAP_REGISTER Cluster G item 6)", () => {
  it("lists support requests, optionally filtered by status", async () => {
    const { sql, calls } = makeSql({
      "from public.support_requests where status": [{ id: "sr1", status: "open" }],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({ path: "/admin-support-requests", query: { status: "open" } }),
      logger,
    );
    expect(result.status).toBe(200);
    expect((result.body as { support_requests: unknown[] }).support_requests).toHaveLength(1);
    expect(calls.some((c) => c.text.includes("where status ="))).toBe(true);
  });

  it("returns a single ticket with its notes", async () => {
    const { sql } = makeSql({
      "select * from public.support_requests where id": [
        { id: "sr1", subject: "Billing question" },
      ],
      "from public.support_request_notes": [{ id: "n1", body: "Looking into it" }],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({ path: "/admin-support-requests/sr1" }),
      logger,
    );
    expect(result.status).toBe(200);
    const body = result.body as { support_request: { id: string }; notes: unknown[] };
    expect(body.support_request.id).toBe("sr1");
    expect(body.notes).toHaveLength(1);
  });

  it("returns 404 for a ticket that doesn't exist", async () => {
    const { sql } = makeSql({ "select * from public.support_requests where id": [] });
    const result = await routeAdminRequest(
      sql,
      baseCtx({ path: "/admin-support-requests/missing" }),
      logger,
    );
    expect(result).toEqual({ status: 404, body: { error: "support_request_not_found" } });
  });

  it("PATCHes status/priority and writes an audit entry", async () => {
    const { sql, calls } = makeSql({
      "select * from public.support_requests where id": [
        { id: "sr1", status: "open", priority: "medium" },
      ],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "PATCH",
        path: "/admin-support-requests/sr1",
        body: { status: "resolved", priority: "low" },
      }),
      logger,
    );
    expect(result.status).toBe(200);
    expect(calls.some((c) => c.text.includes("update public.support_requests set status"))).toBe(
      true,
    );
    expect(calls.some((c) => c.text.includes("update public.support_requests set priority"))).toBe(
      true,
    );
    expect(
      calls.some(
        (c) =>
          c.text.includes("insert into public.admin_actions") &&
          JSON.stringify(c.values).includes("support_request_update"),
      ),
    ).toBe(true);
  });

  it("rejects a PATCH with no recognized fields", async () => {
    const { sql } = makeSql();
    const result = await routeAdminRequest(
      sql,
      baseCtx({ method: "PATCH", path: "/admin-support-requests/sr1", body: {} }),
      logger,
    );
    expect(result).toEqual({ status: 422, body: { error: "no_valid_fields" } });
  });

  it("adds an admin note and writes an audit entry", async () => {
    const { sql, calls } = makeSql({
      "select id from public.support_requests where id": [{ id: "sr1" }],
      "insert into public.support_request_notes": [
        { id: "n1", support_request_id: "sr1", body: "Refund issued", visible_to_tenant: true },
      ],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-support-requests/sr1/notes",
        body: { body: "Refund issued", visible_to_tenant: true },
      }),
      logger,
    );
    expect(result.status).toBe(201);
    expect(
      calls.some(
        (c) =>
          c.text.includes("insert into public.admin_actions") &&
          JSON.stringify(c.values).includes("support_request_note_add"),
      ),
    ).toBe(true);
  });

  it("returns 404 when adding a note to a ticket that doesn't exist", async () => {
    const { sql } = makeSql({ "select id from public.support_requests where id": [] });
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-support-requests/missing/notes",
        body: { body: "hi" },
      }),
      logger,
    );
    expect(result).toEqual({ status: 404, body: { error: "support_request_not_found" } });
  });
});

describe("routeAdminRequest — agent regression group (NIGHTLY-1)", () => {
  it("lists the last 14 days of nightly regression runs on GET /admin-agent-regression", async () => {
    const { sql, calls } = makeSql({
      "from public.agent_regression_runs r": [
        {
          id: "run1",
          tenant_id: "t1",
          tenant_slug: "test-vet-lakeside",
          vertical: "vet",
          started_at: "2026-09-21T09:00:00Z",
          finished_at: "2026-09-21T09:02:00Z",
          scenarios_total: 7,
          scenarios_passed: 7,
          field_capture_ok: true,
          status: "complete",
          retell_batch_test_id: "batch_1",
          failures: [],
        },
      ],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({ path: "/admin-agent-regression" }),
      logger,
    );
    expect(result.status).toBe(200);
    expect((result.body as { runs: unknown[] }).runs).toHaveLength(1);
    expect(calls.some((c) => c.text.includes("interval '14 days'"))).toBe(true);
  });

  it("returns 404 for a non-GET method", async () => {
    const { sql } = makeSql();
    const result = await routeAdminRequest(
      sql,
      baseCtx({ path: "/admin-agent-regression", method: "POST" }),
      logger,
    );
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
  });

  it("still requires platform_admin", async () => {
    const { sql } = makeSql();
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        path: "/admin-agent-regression",
        claims: { app_metadata: { platform_admin: false } },
      }),
      logger,
    );
    expect(result.status).toBe(403);
  });
});
