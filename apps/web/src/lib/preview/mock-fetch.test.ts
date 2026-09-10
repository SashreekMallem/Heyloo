import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PREVIEW_TENANT_ID } from "./fixtures";
import { installPreviewFetchMock } from "./mock-fetch";

const SUPABASE_URL = "https://xyzcompany.supabase.co";

function restUrl(table: string, params: Record<string, string> = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

describe("installPreviewFetchMock — Supabase REST filter handling", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // Force a fresh install for every test — the module-level
    // `__heylooPreviewFetchInstalled` guard would otherwise make every
    // test after the first a no-op.
    // biome-ignore lint/suspicious/noExplicitAny: resetting a test-only internal guard.
    (globalThis as any).__heylooPreviewFetchInstalled = false;
    installPreviewFetchMock();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    // biome-ignore lint/suspicious/noExplicitAny: resetting a test-only internal guard.
    (globalThis as any).__heylooPreviewFetchInstalled = false;
  });

  it("a maybeSingle()-shaped id=eq.<placeholder> lookup returns exactly one row, not the whole table", async () => {
    // call_logs has 8 hand-authored fixture rows — a real
    // `.eq("tenant_id", ...).eq("id", "demo").maybeSingle()` call (the
    // exact pattern every tenant detail page uses) must resolve to a
    // SINGLE row, or postgrest-js's client-side cardinality check
    // (`isMaybeSingle`) sees >1 rows and nulls the result out.
    const res = await fetch(
      restUrl("call_logs", {
        select: "id,tenant_id",
        tenant_id: `eq.${PREVIEW_TENANT_ID}`,
        id: "eq.demo",
      }),
    );
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
  });

  it("a real eq id match still resolves to exactly that row", async () => {
    const res = await fetch(restUrl("call_logs", { select: "id", id: "eq.call-3" }));
    const body = (await res.json()) as { id: string }[];
    expect(body).toEqual([{ id: "call-3" }]);
  });

  it("an in() filter narrows to the matching rows", async () => {
    const res = await fetch(
      restUrl("customers", { select: "id", id: "in.(customer-1,customer-3)" }),
    );
    const body = (await res.json()) as { id: string }[];
    expect(body.map((r) => r.id).sort()).toEqual(["customer-1", "customer-3"]);
  });

  it("a tenant_id eq filter that genuinely matches nothing returns an empty array (no id-column fallback)", async () => {
    const res = await fetch(restUrl("customers", { select: "id", tenant_id: "eq.does-not-exist" }));
    const body = (await res.json()) as unknown[];
    expect(body).toEqual([]);
  });

  it("an unfiltered list request is unaffected (still returns every fixture row)", async () => {
    const res = await fetch(restUrl("customers", { select: "id" }));
    const body = (await res.json()) as unknown[];
    expect(body.length).toBeGreaterThan(1);
  });
});

describe("installPreviewFetchMock — /api/** fixtures", () => {
  beforeEach(() => {
    // biome-ignore lint/suspicious/noExplicitAny: resetting a test-only internal guard.
    (globalThis as any).__heylooPreviewFetchInstalled = false;
    installPreviewFetchMock();
  });

  afterEach(() => {
    // biome-ignore lint/suspicious/noExplicitAny: resetting a test-only internal guard.
    (globalThis as any).__heylooPreviewFetchInstalled = false;
  });

  it("GET /api/tenant/setup-progress matches SetupProgressPanel's expected shape", async () => {
    const res = await fetch("/api/tenant/setup-progress");
    const body = (await res.json()) as {
      steps: unknown[];
      requiredTotal: number;
      requiredDone: number;
      complete: boolean;
    };
    expect(Array.isArray(body.steps)).toBe(true);
    expect(body.steps.length).toBeGreaterThan(0);
    expect(typeof body.requiredTotal).toBe("number");
    expect(typeof body.requiredDone).toBe("number");
  });

  it("GET /api/tenant/team matches TeamListResponse", async () => {
    const res = await fetch("/api/tenant/team");
    const body = (await res.json()) as { members: unknown[] };
    expect(Array.isArray(body.members)).toBe(true);
    expect(body.members.length).toBeGreaterThan(0);
  });

  it("GET /api/admin/admin-tenants/demo resolves a dynamic detail fixture (not the generic { rows: [] } fallback)", async () => {
    const res = await fetch("/api/admin/admin-tenants/demo");
    const body = (await res.json()) as { name?: string; mrr_cents?: number };
    expect(body.name).toBeTruthy();
    expect(typeof body.mrr_cents).toBe("number");
  });

  it("GET /api/admin/admin-support-requests/demo/notes resolves the notes sub-route distinctly from the ticket route", async () => {
    const res = await fetch("/api/admin/admin-support-requests/demo/notes");
    const body = (await res.json()) as { notes?: unknown[] };
    expect(Array.isArray(body.notes)).toBe(true);
  });

  it("POST /api/tenant/refer/ensure-link resolves a real funnel shape, not the generic { ok: true }", async () => {
    const res = await fetch("/api/tenant/refer/ensure-link", { method: "POST" });
    const body = (await res.json()) as { code?: string; funnel?: { signups: number } };
    expect(body.code).toBeTruthy();
    expect(body.funnel?.signups).toBeGreaterThan(0);
  });

  it("an unmapped /api/** route still falls back to the non-crashing generic shape", async () => {
    const res = await fetch("/api/tenant/some-unmapped-route");
    const body = (await res.json()) as { rows?: unknown[] };
    expect(body).toEqual({ rows: [] });
  });
});
