import { describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "maybeSingle"]) {
    obj[method] = vi.fn(() => obj);
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

let session: { user: { app_metadata: { tenant_id?: string } } } | null = null;
let serviceQueue: Record<string, unknown[]> = {};

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: { getSession: async () => ({ data: { session } }) },
  }),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createSupabaseServiceRoleServerClient: () => ({
    from: vi.fn((table: string) => {
      const q = serviceQueue[table];
      const result = q?.length ? q.shift() : { data: null, error: null };
      return chain(result);
    }),
  }),
}));

const { GET } = await import("./route");

describe("GET /api/platform-settings/tenant-plan", () => {
  it("401s when unauthenticated", async () => {
    session = null;
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("403s when the session has no tenant_id claim", async () => {
    session = { user: { app_metadata: {} } };
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("defaults included_text_conversations/overage to the documented BACKEND_SPEC defaults when absent from the price card", async () => {
    session = { user: { app_metadata: { tenant_id: "t1" } } };
    serviceQueue = {
      tenants: [{ data: { vertical: "dental" }, error: null }],
      platform_settings: [
        {
          data: { value: { included_minutes: 300, base_cents: 29900, overage_cents: 45 } },
          error: null,
        },
        { data: null, error: null },
      ],
    };
    const res = await GET();
    const body = (await res.json()) as {
      included_text_conversations: number;
      text_conversation_overage_cents: number;
    };
    expect(body.included_text_conversations).toBe(200);
    expect(body.text_conversation_overage_cents).toBe(5);
  });

  it("passes through explicit price-card values when present", async () => {
    session = { user: { app_metadata: { tenant_id: "t1" } } };
    serviceQueue = {
      tenants: [{ data: { vertical: "auto" }, error: null }],
      platform_settings: [
        {
          data: {
            value: {
              included_minutes: 300,
              base_cents: 29900,
              overage_cents: 35,
              included_text_conversations: 500,
              text_conversation_overage_cents: 3,
            },
          },
          error: null,
        },
        { data: null, error: null },
      ],
    };
    const res = await GET();
    const body = (await res.json()) as {
      included_text_conversations: number;
      text_conversation_overage_cents: number;
    };
    expect(body.included_text_conversations).toBe(500);
    expect(body.text_conversation_overage_cents).toBe(3);
  });
});
