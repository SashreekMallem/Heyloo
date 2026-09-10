import { describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in"]) {
    obj[method] = vi.fn(() => obj);
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

let fromResult: unknown = { data: [], error: null };
let mockSession: { user: { app_metadata: Record<string, unknown> }; access_token: string } | null =
  null;

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: mockSession } }) },
    from: vi.fn(() => chain(fromResult)),
  }),
}));

const { GET } = await import("./route");

function ownerSession(overrides: Record<string, unknown> = {}) {
  return {
    user: { app_metadata: { tenant_id: "t1", role: "owner", ...overrides } },
    access_token: "at1",
  };
}

describe("GET /api/tenant/integrations", () => {
  it("401s when unauthenticated", async () => {
    mockSession = null;
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("lists all four adapters as disconnected when adapter_connections has no rows", async () => {
    mockSession = ownerSession();
    fromResult = { data: [], error: null };
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { integrations: { provider: string; status: string }[] };
    expect(body.integrations).toHaveLength(4);
    expect(body.integrations.every((i) => i.status === "disconnected")).toBe(true);
    expect(body.integrations.map((i) => i.provider).sort()).toEqual(
      ["ezyvet", "google_calendar", "shopmonkey", "square"].sort(),
    );
  });

  it("reflects a connected row's status/last_refreshed_at/last_error", async () => {
    mockSession = ownerSession();
    fromResult = {
      data: [
        {
          provider: "square",
          status: "connected",
          last_refreshed_at: "2026-09-01T00:00:00Z",
          last_error: null,
        },
        { provider: "shopmonkey", status: "error", last_refreshed_at: null, last_error: "revoked" },
      ],
      error: null,
    };
    const res = await GET();
    const body = (await res.json()) as {
      integrations: { provider: string; status: string; last_error: string | null }[];
    };
    const square = body.integrations.find((i) => i.provider === "square");
    const shopmonkey = body.integrations.find((i) => i.provider === "shopmonkey");
    expect(square?.status).toBe("connected");
    expect(shopmonkey?.status).toBe("error");
    expect(shopmonkey?.last_error).toBe("revoked");
  });

  it("marks can_manage false for a member role", async () => {
    mockSession = ownerSession({ role: "member" });
    fromResult = { data: [], error: null };
    const res = await GET();
    const body = (await res.json()) as { integrations: { can_manage: boolean }[] };
    expect(body.integrations.every((i) => i.can_manage === false)).toBe(true);
  });
});
