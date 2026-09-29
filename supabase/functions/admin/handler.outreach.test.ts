import { outreachCampaignSchema } from "@heyloo/canonical-types";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import type { AdminRequestContext } from "./handler.ts";
import { routeAdminRequest } from "./handler.ts";
import { OutreachCampaignCreateSchema } from "./schemas.ts";

const logger = createLogger();
const CAMPAIGN_ID = "00000000-0000-4000-8000-0000000000c1";
const TEMPLATE_ID = "3f2a9c1e-0000-4000-8000-000000000001";

function ctx(overrides: Partial<AdminRequestContext>): AdminRequestContext {
  return {
    method: "GET",
    path: "/admin-outreach/campaigns",
    claims: { app_metadata: { platform_admin: true } },
    body: undefined,
    adminUserId: "admin_1",
    ...overrides,
  };
}

function makeSql(fixtures: Record<string, unknown[]> = {}) {
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

/** Exactly what `campaigns/new/page.tsx` submits. */
const FORM_BODY = {
  name: "Q1 legal",
  vertical: "legal",
  sending_domain: "Mail.Heyloo.AI",
  daily_send_cap: 250,
  template_id: TEMPLATE_ID,
  respect_suppression: true,
};

const OUTREACH_DEPS = {
  outreach: {
    smartleadFetchImpl: vi.fn(
      async () => new Response(JSON.stringify({ id: 555 }), { status: 200 }),
    ) as never,
    smartleadApiKey: "key",
    canSpamFooter: "Acme, 123 Main St",
  },
};

// COCKPIT-F08
describe("POST admin-outreach/campaigns — the form's contract", () => {
  it("accepts sending_domain / daily_send_cap / template_id and persists them", async () => {
    const { sql, calls } = makeSql({ "insert into public.campaigns": [{ id: CAMPAIGN_ID }] });
    const result = await routeAdminRequest(
      sql,
      ctx({ method: "POST", body: FORM_BODY }),
      logger,
      OUTREACH_DEPS,
    );
    expect(result).toEqual({
      status: 201,
      body: { campaign_id: CAMPAIGN_ID, external_campaign_id: "555" },
    });
    const insert = calls.find((c) => c.text.includes("insert into public.campaigns"));
    // lower-cased domain, the cap and the template land in the row
    expect(insert?.values).toEqual(
      expect.arrayContaining(["Q1 legal", "legal", "mail.heyloo.ai", 250, TEMPLATE_ID]),
    );
    expect(insert?.text).toContain("daily_send_cap");
    expect(insert?.text).toContain("template_id");
  });

  it("stores a blank template as null", async () => {
    const { sql, calls } = makeSql({ "insert into public.campaigns": [{ id: CAMPAIGN_ID }] });
    await routeAdminRequest(
      sql,
      ctx({ method: "POST", body: { ...FORM_BODY, template_id: "" } }),
      logger,
      OUTREACH_DEPS,
    );
    const insert = calls.find((c) => c.text.includes("insert into public.campaigns"));
    expect(insert?.values).toContain(null);
    expect(insert?.values).not.toContain("");
  });

  it("answers 501 (not configured) for a VALID form when Smartlead is not wired", async () => {
    const { sql } = makeSql();
    const result = await routeAdminRequest(sql, ctx({ method: "POST", body: FORM_BODY }), logger);
    expect(result).toEqual({ status: 501, body: { error: "outreach_sender_not_configured" } });
  });

  it("answers 422 with field issues for an invalid form even when Smartlead is not wired", async () => {
    const { sql, calls } = makeSql();
    const result = await routeAdminRequest(
      sql,
      ctx({
        method: "POST",
        body: { ...FORM_BODY, sending_domain: "not a domain", daily_send_cap: 9_999_999 },
      }),
      logger,
    );
    expect(result.status).toBe(422);
    const body = result.body as { error: string; issues: { path: string[] }[] };
    expect(body.error).toBe("invalid_campaign");
    expect(body.issues.map((i) => i.path[0]).sort()).toEqual(["daily_send_cap", "sending_domain"]);
    expect(calls).toHaveLength(0);
  });

  it("still takes the legacy sender_domain spelling", async () => {
    const { sql } = makeSql({ "insert into public.campaigns": [{ id: CAMPAIGN_ID }] });
    const { sending_domain: _dropped, ...rest } = FORM_BODY;
    const result = await routeAdminRequest(
      sql,
      ctx({ method: "POST", body: { ...rest, sender_domain: "mail.heyloo.ai" } }),
      logger,
      OUTREACH_DEPS,
    );
    expect(result.status).toBe(201);
  });
});

// COCKPIT-F23: two copies of one schema must not drift.
describe("OutreachCampaignCreateSchema parity with the canonical schema", () => {
  const cases: Record<string, unknown>[] = [
    FORM_BODY,
    { ...FORM_BODY, template_id: "" },
    { ...FORM_BODY, template_id: undefined },
    { ...FORM_BODY, template_id: "tmpl_1" },
    { ...FORM_BODY, sending_domain: "localhost" },
    { ...FORM_BODY, sending_domain: "a..b.com" },
    { ...FORM_BODY, sending_domain: "http://x.example.com" },
    { ...FORM_BODY, sending_domain: "  X.Example.Com  " },
    { ...FORM_BODY, daily_send_cap: 0 },
    { ...FORM_BODY, daily_send_cap: 2000 },
    { ...FORM_BODY, daily_send_cap: 2001 },
    { ...FORM_BODY, daily_send_cap: 1.5 },
    { ...FORM_BODY, vertical: "spa" },
    { ...FORM_BODY, respect_suppression: false },
    { ...FORM_BODY, name: "   " },
  ];
  it.each(cases.map((c, i) => [i, c] as const))("case %i agrees", (_i, input) => {
    const a = outreachCampaignSchema.safeParse(input);
    const b = OutreachCampaignCreateSchema.safeParse(input);
    expect(b.success).toBe(a.success);
    if (a.success && b.success) expect(b.data).toEqual(a.data);
  });
});

describe("GET admin-outreach/campaigns/:id (COCKPIT-F08)", () => {
  it("returns the campaign with funnel stages and the page's lead rows", async () => {
    const { sql } = makeSql({
      "from public.campaigns where id": [
        { id: CAMPAIGN_ID, name: "Q1 legal", status: "draft", sender_domain: "mail.heyloo.ai" },
      ],
      "from public.send_events se": [{ added: 10, sent: 8, opened: 4, clicked: 1, replied: 2 }],
      "from public.leads l": [
        {
          id: "l1",
          company_name: "Acme Law",
          contact_name: "Jo",
          email: "jo@acme.example",
          status: "suppressed",
          phone_complaint_score: "0.5",
        },
      ],
    });
    const result = await routeAdminRequest(
      sql,
      ctx({ path: `/admin-outreach/campaigns/${CAMPAIGN_ID}` }),
      logger,
    );
    expect(result.status).toBe(200);
    const body = result.body as {
      name: string;
      funnel: { label: string; count: number }[];
      leads: Record<string, unknown>[];
    };
    expect(body.name).toBe("Q1 legal");
    expect(body.funnel).toEqual([
      { label: "Leads added", count: 10 },
      { label: "Sent", count: 8 },
      { label: "Opened", count: 4 },
      { label: "Clicked", count: 1 },
      { label: "Replied", count: 2 },
    ]);
    expect(body.leads[0]).toMatchObject({
      id: "l1",
      companyName: "Acme Law",
      suppressed: true,
      phoneComplaintScore: 0.5,
    });
  });

  it("404s an unknown campaign", async () => {
    const { sql } = makeSql();
    const result = await routeAdminRequest(
      sql,
      ctx({ path: `/admin-outreach/campaigns/${CAMPAIGN_ID}` }),
      logger,
    );
    expect(result).toEqual({ status: 404, body: { error: "campaign_not_found" } });
  });
});

describe("outreach funnel + leads filters", () => {
  it("funnel adds the overall complaint rate as a percentage (COCKPIT-F09)", async () => {
    const { sql } = makeSql({
      "select status, count(*)::int as count from public.leads": [{ status: "new", count: 3 }],
      "from public.send_events": [{ rate: "0.0025" }],
    });
    const result = await routeAdminRequest(sql, ctx({ path: "/admin-outreach/funnel" }), logger);
    const body = result.body as { leads_by_status: unknown[]; complaint_rate_pct: number };
    expect(body.leads_by_status).toEqual([{ status: "new", count: 3 }]);
    expect(body.complaint_rate_pct).toBeCloseTo(0.25);
  });

  it("clamps min_score into 0-1 server-side (COCKPIT-F23)", async () => {
    const { sql, calls } = makeSql();
    await routeAdminRequest(
      sql,
      ctx({ path: "/admin-outreach/leads", query: { min_score: "7" } }),
      logger,
    );
    expect(calls[0]?.values).toContain(1);
    expect(calls[0]?.values).not.toContain(7);
  });
});
