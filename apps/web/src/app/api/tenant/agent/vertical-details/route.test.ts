import { describe, expect, it, vi } from "vitest";

function chain(result: unknown, onUpdate?: (payload: unknown) => void) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "maybeSingle"]) {
    obj[method] = vi.fn(() => obj);
  }
  obj["update"] = vi.fn((payload: unknown) => {
    onUpdate?.(payload);
    return obj;
  });
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

/** Records every table's update() payload (keyed by table name) rather than
 * just the last call — this route now issues two updates (agent_configs,
 * then a best-effort tenants.policies_reviewed_at touch). */
function makeFrom(queue: unknown[], onUpdate?: (table: string, payload: unknown) => void) {
  return vi.fn((table: string) => {
    const result = queue.length ? queue.shift() : { data: null, error: null };
    return chain(result, (payload) => onUpdate?.(table, payload));
  });
}

const mockUser = { id: "u1", app_metadata: { tenant_id: "t1", role: "owner" } };

let mockGetUser: () => Promise<{ data: { user: unknown } }> = async () => ({
  data: { user: null },
});
const queue: unknown[] = [];
let fromMock = makeFrom(queue);

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: { getUser: () => mockGetUser() },
    from: (table: string) => fromMock(table),
  }),
}));

const { POST } = await import("./route");

const validPayload = {
  cancellation_policy: { window_hours: 24, text: "24-hour notice required" },
};

function postRequest(body: unknown) {
  return new Request("http://localhost/api/tenant/agent/vertical-details", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/tenant/agent/vertical-details", () => {
  it("401s when unauthenticated", async () => {
    mockGetUser = async () => ({ data: { user: null } });
    const res = await POST(postRequest(validPayload));
    expect(res.status).toBe(401);
  });

  it("403s when the caller has no tenant_id claim", async () => {
    mockGetUser = async () => ({ data: { user: { id: "u1", app_metadata: {} } } });
    const res = await POST(postRequest(validPayload));
    expect(res.status).toBe(403);
  });

  it("422s on a payload that fails verticalDetailsSchema", async () => {
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await POST(postRequest({ cancellation_policy: { window_hours: -1, text: "x" } }));
    expect(res.status).toBe(422);
  });

  it("merges the new fields into the existing dynamic_variable_overrides, scoped to the caller's own tenant_id", async () => {
    mockGetUser = async () => ({ data: { user: mockUser } });
    const updatePayloads: Record<string, unknown> = {};
    fromMock = makeFrom(
      [
        { data: { dynamic_variable_overrides: { manager_name: "Sam" } }, error: null },
        { error: null },
        { error: null }, // tenants.policies_reviewed_at best-effort touch
      ],
      (table, payload) => {
        updatePayloads[table] = payload;
      },
    );

    const res = await POST(postRequest(validPayload));
    expect(res.status).toBe(200);
    expect(updatePayloads["agent_configs"]).toEqual({
      dynamic_variable_overrides: {
        manager_name: "Sam",
        cancellation_policy: validPayload.cancellation_policy,
      },
    });
    // cancellation_policy.text is non-empty in validPayload — the route
    // touches tenants.policies_reviewed_at as a real, timestamped
    // acknowledgment signal (FIX_REQUESTS.md).
    expect(updatePayloads["tenants"]).toHaveProperty("policies_reviewed_at");
  });

  it("500s when the update fails", async () => {
    mockGetUser = async () => ({ data: { user: mockUser } });
    fromMock = makeFrom([
      { data: { dynamic_variable_overrides: {} }, error: null },
      { error: { message: "db down" } },
    ]);
    const res = await POST(postRequest(validPayload));
    expect(res.status).toBe(500);
  });
});
