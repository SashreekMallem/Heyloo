import { describe, expect, it, vi } from "vitest";
import type { WebhookDeliveryDeps } from "../_shared/outbound/delivery.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";
import {
  authorizeTenantWebhooksCaller,
  handleTenantWebhooks,
  type TenantWebhooksDeps,
} from "./handler.ts";

const TENANT = "0b6c2f3e-8f43-4a43-9d51-6a2d1c0e7f10";
const DEST = "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
const DELIVERY = "9e0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b";
const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSwMfKQ9r8GKYqrTwjUPD8ILPZ=";
const PUBLIC_DNS = async (_h: string, type: "A" | "AAAA") =>
  type === "A" ? ["93.184.216.34"] : [];

type Call = { text: string; values: unknown[] };
type Answer = unknown[] | ((values: unknown[]) => unknown[]) | Error;

function fakeSql(answers: Array<[string, Answer]> = []) {
  const calls: Call[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    for (const [marker, answer] of answers) {
      if (!text.includes(marker)) continue;
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve(typeof answer === "function" ? answer(values) : answer);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  const find = (marker: string) => calls.filter((c) => c.text.includes(marker));
  return { sql, calls, find };
}

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function deps(
  overrides: Partial<TenantWebhooksDeps> = {},
  delivery: Partial<WebhookDeliveryDeps> = {},
) {
  return {
    logger,
    resolver: PUBLIC_DNS,
    generateSecret: () => SECRET,
    delivery: {
      appBaseUrl: "https://heyloo.app",
      logger,
      resolver: PUBLIC_DNS,
      transport: vi.fn(async () => new Response("ok")),
      ...delivery,
    },
    ...overrides,
  } satisfies TenantWebhooksDeps;
}

const destinationRow = {
  id: DEST,
  name: "Zapier",
  url: "https://hooks.zapier.com/hooks/catch/1/abc/",
  event_types: ["order.created"],
  enabled: true,
  disabled_reason: null,
  consecutive_failures: 0,
  last_success_at: null,
  last_failure_at: null,
  last_error: null,
  created_at: "2026-10-09T18:00:00.000Z",
  updated_at: "2026-10-09T18:00:00.000Z",
};

/** Every statement the handler runs must carry the verified tenant id. */
function expectTenantScoped(calls: Call[]) {
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) {
    expect(call.values, call.text).toContain(TENANT);
    expect(call.text).toMatch(/tenant_id|t\.id =/);
  }
}

describe("authorizeTenantWebhooksCaller", () => {
  const claims = (meta: Record<string, unknown>) => ({ app_metadata: meta });

  it("accepts an owner or admin of a tenant, taking the tenant from the JWT only", () => {
    expect(authorizeTenantWebhooksCaller(claims({ tenant_id: TENANT, role: "owner" }))).toEqual({
      ok: true,
      tenantId: TENANT,
    });
    expect(authorizeTenantWebhooksCaller(claims({ tenant_id: TENANT, role: "admin" })).ok).toBe(
      true,
    );
  });

  it("refuses members, missing/garbled tenants and no claims at all", () => {
    expect(authorizeTenantWebhooksCaller(claims({ tenant_id: TENANT, role: "member" })).ok).toBe(
      false,
    );
    expect(authorizeTenantWebhooksCaller(claims({ tenant_id: TENANT })).ok).toBe(false);
    expect(authorizeTenantWebhooksCaller(claims({ role: "owner" })).ok).toBe(false);
    expect(
      authorizeTenantWebhooksCaller(claims({ tenant_id: "x' or 1=1", role: "owner" })).ok,
    ).toBe(false);
    expect(authorizeTenantWebhooksCaller(null).ok).toBe(false);
    expect(authorizeTenantWebhooksCaller({}).ok).toBe(false);
  });

  it("refuses a read-only impersonation session, allows an edit-enabled one", () => {
    const base = { tenant_id: TENANT, role: "owner", impersonated_by: "admin-user" };
    expect(authorizeTenantWebhooksCaller(claims(base)).ok).toBe(false);
    expect(
      authorizeTenantWebhooksCaller(claims({ ...base, impersonation_edit_enabled: "true" })).ok,
    ).toBe(false);
    expect(
      authorizeTenantWebhooksCaller(claims({ ...base, impersonation_edit_enabled: true })).ok,
    ).toBe(true);
  });
});

describe("create", () => {
  const request = {
    action: "create" as const,
    name: "Zapier",
    url: "https://hooks.zapier.com/hooks/catch/1/abc/",
  };

  it("creates the row and the Vault secret in one statement and returns the secret once", async () => {
    const { sql, calls, find } = fakeSql([
      ["select count(*)::int as n", [{ n: 2 }]],
      ["insert into public.outbound_destinations", [destinationRow]],
    ]);
    const result = await handleTenantWebhooks(sql, TENANT, request, deps());
    expect(result).toEqual({
      status: 200,
      body: { destination: destinationRow, signing_secret: SECRET },
    });
    const insert = find("insert into public.outbound_destinations")[0];
    expect(insert?.text).toContain("public.fn_outbound_secret_create(");
    expect(insert?.text).not.toContain("signing_secret_id,\n        last_success_at");
    expect(insert?.text.split("returning")[1]).not.toContain("signing_secret_id");
    expect(insert?.values).toEqual([
      TENANT,
      "Zapier",
      request.url,
      [
        "booking.created",
        "booking.updated",
        "booking.cancelled",
        "order.created",
        "order.updated",
        "order.cancelled",
        "message.taken",
      ],
      SECRET,
    ]);
    expectTenantScoped(calls);
  });

  it("keeps the chosen event types", async () => {
    const { sql, find } = fakeSql([["insert into public.outbound_destinations", [destinationRow]]]);
    await handleTenantWebhooks(sql, TENANT, { ...request, event_types: ["order.created"] }, deps());
    expect(find("insert into")[0]?.values[3]).toEqual(["order.created"]);
  });

  it("refuses a sixth destination", async () => {
    const { sql, find } = fakeSql([["select count(*)::int as n", [{ n: 5 }]]]);
    expect(await handleTenantWebhooks(sql, TENANT, request, deps())).toEqual({
      status: 409,
      body: { error: "destination_limit", limit: 5 },
    });
    expect(find("insert into")).toHaveLength(0);
  });

  it("maps the database limit guard (concurrent creates) to the same 409", async () => {
    const limit = Object.assign(new Error("outbound destination limit reached"), {
      hint: "outbound_destination_limit",
    });
    const { sql } = fakeSql([["insert into public.outbound_destinations", limit]]);
    expect(await handleTenantWebhooks(sql, TENANT, request, deps())).toMatchObject({
      status: 409,
      body: { error: "destination_limit" },
    });
  });

  it("maps the table's URL CHECK (schema drift safety net) to a 422, not a 500", async () => {
    const check = Object.assign(new Error("violates check constraint"), {
      code: "23514",
      constraint_name: "outbound_destinations_url_chk",
    });
    const { sql } = fakeSql([["insert into public.outbound_destinations", check]]);
    expect(await handleTenantWebhooks(sql, TENANT, request, deps())).toMatchObject({
      status: 422,
      body: { error: "url_not_allowed" },
    });
    const other = Object.assign(new Error("violates check constraint"), {
      code: "23514",
      constraint_name: "outbound_destinations_name_length_chk",
    });
    const { sql: sql2 } = fakeSql([["insert into public.outbound_destinations", other]]);
    await expect(handleTenantWebhooks(sql2, TENANT, request, deps())).rejects.toBe(other);
  });

  it("rejects private, internal and unresolvable addresses up front", async () => {
    const { sql, calls } = fakeSql();
    for (const url of [
      "https://localhost/hook",
      "https://10.0.0.5/hook",
      "https://metadata.google.internal/x",
      "https://hooks.example.com:8443/x",
    ]) {
      const result = await handleTenantWebhooks(sql, TENANT, { ...request, url }, deps());
      expect(result.status, url).toBe(422);
      expect(result.body["error"]).toBe("url_not_allowed");
    }
    const privateDns = async (_h: string, type: "A" | "AAAA") =>
      type === "A" ? ["192.168.1.2"] : [];
    expect(
      (await handleTenantWebhooks(sql, TENANT, request, deps({ resolver: privateDns }))).status,
    ).toBe(422);
    const noDns = async () => [];
    expect(
      await handleTenantWebhooks(sql, TENANT, request, deps({ resolver: noDns })),
    ).toMatchObject({
      status: 422,
      body: { message: "We couldn't find that web address. Check it for typos." },
    });
    expect(calls).toHaveLength(0);
  });
});

describe("update", () => {
  it("updates only this tenant's destination and turning it on clears the failure state", async () => {
    const { sql, calls } = fakeSql([["update public.outbound_destinations", [destinationRow]]]);
    const result = await handleTenantWebhooks(
      sql,
      TENANT,
      { action: "update", id: DEST, enabled: true },
      deps(),
    );
    expect(result).toEqual({ status: 200, body: { destination: destinationRow } });
    const update = calls[0];
    expect(update?.text).toContain("where id =");
    expect(update?.values.slice(-2)).toEqual([DEST, TENANT]);
    // name, url, event_types untouched (null -> coalesce keeps them); enabled true.
    expect(update?.values.slice(0, 3)).toEqual([null, null, null]);
    expect(update?.values.slice(3, 7)).toEqual([true, true, true, true]);
    expect(update?.text).toContain("else 'owner'");
    expectTenantScoped(calls);
  });

  it("never passes undefined to the driver", async () => {
    const { sql, calls } = fakeSql([["update public.outbound_destinations", [destinationRow]]]);
    await handleTenantWebhooks(sql, TENANT, { action: "update", id: DEST, name: "Make" }, deps());
    expect(calls[0]?.values).not.toContain(undefined);
    expect(calls[0]?.values[0]).toBe("Make");
  });

  it("404s another tenant's (or a missing) destination", async () => {
    const { sql } = fakeSql();
    expect(
      await handleTenantWebhooks(
        sql,
        TENANT,
        { action: "update", id: DEST, enabled: false },
        deps(),
      ),
    ).toEqual({ status: 404, body: { error: "not_found" } });
  });

  it("maps the table's URL CHECK on update to a 422", async () => {
    const check = Object.assign(new Error("violates check constraint"), {
      code: "23514",
      constraint_name: "outbound_destinations_url_chk",
    });
    const { sql } = fakeSql([["update public.outbound_destinations", check]]);
    expect(
      await handleTenantWebhooks(
        sql,
        TENANT,
        { action: "update", id: DEST, url: "https://hooks.example.com/x" },
        deps(),
      ),
    ).toMatchObject({ status: 422, body: { error: "url_not_allowed" } });
  });

  it("re-checks a changed URL", async () => {
    const { sql, calls } = fakeSql();
    const result = await handleTenantWebhooks(
      sql,
      TENANT,
      { action: "update", id: DEST, url: "https://127.0.0.1/x" },
      deps(),
    );
    expect(result.status).toBe(422);
    expect(calls).toHaveLength(0);
  });
});

describe("delete and rotate_secret", () => {
  it("deletes only within the tenant", async () => {
    const { sql, calls } = fakeSql([["delete from public.outbound_destinations", [{ id: DEST }]]]);
    expect(await handleTenantWebhooks(sql, TENANT, { action: "delete", id: DEST }, deps())).toEqual(
      {
        status: 200,
        body: { deleted: true },
      },
    );
    expect(calls[0]?.values).toEqual([DEST, TENANT]);
    expect(
      await handleTenantWebhooks(fakeSql().sql, TENANT, { action: "delete", id: DEST }, deps()),
    ).toEqual({ status: 404, body: { error: "not_found" } });
  });

  it("rotates in Vault and returns the new secret", async () => {
    const { sql, calls } = fakeSql([["fn_outbound_secret_rotate", [{ rotated: true }]]]);
    expect(
      await handleTenantWebhooks(sql, TENANT, { action: "rotate_secret", id: DEST }, deps()),
    ).toEqual({ status: 200, body: { signing_secret: SECRET } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.values).toEqual([DEST, TENANT, SECRET]);
  });

  it("re-creates a missing Vault secret on rotate", async () => {
    const { sql, find } = fakeSql([
      ["fn_outbound_secret_rotate", [{ rotated: false }]],
      ["set signing_secret_id = public.fn_outbound_secret_create", [{ id: DEST }]],
    ]);
    const result = await handleTenantWebhooks(
      sql,
      TENANT,
      { action: "rotate_secret", id: DEST },
      deps(),
    );
    expect(result.status).toBe(200);
    expect(find("fn_outbound_secret_create")[0]?.values).toEqual([SECRET, DEST, TENANT]);
  });

  it("404s rotate for a destination outside the tenant", async () => {
    expect(
      await handleTenantWebhooks(
        fakeSql().sql,
        TENANT,
        { action: "rotate_secret", id: DEST },
        deps(),
      ),
    ).toEqual({ status: 404, body: { error: "not_found" } });
  });
});

describe("send_test", () => {
  const claimedTest = {
    id: DELIVERY,
    tenant_id: TENANT,
    destination_id: DEST,
    event_id: "aa0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b",
    attempt_count: 1,
    url: "https://hooks.example.com/in",
    destination_name: "Zapier",
    destination_enabled: true,
    secret: SECRET,
    event_type: "test.ping",
    entity_type: "test",
    entity_id: null,
    occurred_at: new Date("2026-10-09T18:00:00Z"),
    payload: null,
  };

  it("enqueues a test ping for this destination only and sends it in-request", async () => {
    const transport = vi.fn(async () => new Response(null, { status: 204 }));
    const { sql, calls, find } = fakeSql([
      ["insert into public.outbound_deliveries", [{ id: DELIVERY }]],
      ["update public.outbound_deliveries od", [claimedTest]],
      ["from public.tenants t", [{ tenant_name: "Shop" }]],
      ["set payload =", [{ payload: { type: "test.ping" } }]],
      ["set status = 'delivered'", [{ id: DELIVERY }]],
    ]);
    const result = await handleTenantWebhooks(
      sql,
      TENANT,
      { action: "send_test", id: DEST },
      deps({}, { transport }),
    );
    expect(result).toEqual({
      status: 200,
      body: { ok: true, status_code: 204, error: null, delivery_id: DELIVERY },
    });
    const insert = find("insert into public.outbound_deliveries")[0];
    expect(insert?.text).toContain("'test.ping', 'test'");
    expect(insert?.values).toEqual([DEST, TENANT, DEST]);
    expect(transport).toHaveBeenCalledTimes(1);
    expectTenantScoped(calls);
  });

  it("reports the receiver's failure (single attempt, no retry)", async () => {
    const transport = vi.fn(async () => new Response("nope", { status: 404 }));
    const { sql, find } = fakeSql([
      ["insert into public.outbound_deliveries", [{ id: DELIVERY }]],
      [
        "update public.outbound_deliveries od",
        [{ ...claimedTest, payload: { type: "test.ping" } }],
      ],
      ["set status = 'failed'", [{ id: DELIVERY }]],
    ]);
    const result = await handleTenantWebhooks(
      sql,
      TENANT,
      { action: "send_test", id: DEST },
      deps({}, { transport }),
    );
    expect(result.body).toEqual({
      ok: false,
      status_code: 404,
      error: "HTTP 404",
      delivery_id: DELIVERY,
    });
    expect(find("set status = 'retrying'")).toHaveLength(0);
  });

  it("404s a destination outside the tenant and sends nothing", async () => {
    const transport = vi.fn(async () => new Response("ok"));
    expect(
      await handleTenantWebhooks(
        fakeSql().sql,
        TENANT,
        { action: "send_test", id: DEST },
        deps({}, { transport }),
      ),
    ).toEqual({ status: 404, body: { error: "not_found" } });
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("retry", () => {
  it("re-queues a failed delivery of this tenant for the next tick", async () => {
    const { sql, calls, find } = fakeSql([
      ["from public.outbound_deliveries od", [{ status: "failed", destination_enabled: true }]],
      ["set status = 'retrying', next_attempt_at = now()", [{ id: DELIVERY }]],
    ]);
    expect(
      await handleTenantWebhooks(sql, TENANT, { action: "retry", delivery_id: DELIVERY }, deps()),
    ).toEqual({ status: 200, body: { delivery_id: DELIVERY, status: "retrying" } });
    expect(find("set status = 'retrying'")[0]?.text).toContain("status in ('failed', 'retrying')");
    expectTenantScoped(calls);
  });

  it("refuses delivered rows, turned-off destinations and other tenants' rows", async () => {
    const delivered = fakeSql([
      ["from public.outbound_deliveries od", [{ status: "delivered", destination_enabled: true }]],
    ]);
    expect(
      await handleTenantWebhooks(
        delivered.sql,
        TENANT,
        { action: "retry", delivery_id: DELIVERY },
        deps(),
      ),
    ).toEqual({ status: 409, body: { error: "not_retryable", status: "delivered" } });

    const off = fakeSql([
      ["from public.outbound_deliveries od", [{ status: "failed", destination_enabled: false }]],
    ]);
    expect(
      await handleTenantWebhooks(
        off.sql,
        TENANT,
        { action: "retry", delivery_id: DELIVERY },
        deps(),
      ),
    ).toEqual({ status: 409, body: { error: "destination_disabled" } });

    expect(
      await handleTenantWebhooks(
        fakeSql().sql,
        TENANT,
        { action: "retry", delivery_id: DELIVERY },
        deps(),
      ),
    ).toEqual({ status: 404, body: { error: "not_found" } });
  });
});
