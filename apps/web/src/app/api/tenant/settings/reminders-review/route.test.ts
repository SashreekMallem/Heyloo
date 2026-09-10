import { describe, expect, it, vi } from "vitest";

function chain(result: unknown, onUpdate?: (payload: unknown) => void) {
  const obj: Record<string, unknown> = { eq: vi.fn(() => obj) };
  obj["update"] = vi.fn((payload: unknown) => {
    onUpdate?.(payload);
    return obj;
  });
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

const mockUser = { id: "u1", app_metadata: { tenant_id: "t1", role: "owner" } };

let mockGetUser: () => Promise<{ data: { user: unknown } }> = async () => ({
  data: { user: null },
});
let updateResult: unknown = { error: null };
let lastUpdatePayload: unknown;
let lastTable: string | undefined;
const from = vi.fn((table: string) => {
  lastTable = table;
  return chain(updateResult, (payload) => {
    lastUpdatePayload = payload;
  });
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: { getUser: () => mockGetUser() },
    from,
  }),
}));

const { POST } = await import("./route");

const validPayload = {
  voice_reminders_enabled: true,
  review_request_enabled: true,
  review_url: "https://reviews.example.com/acme",
  avg_transaction_value_cents: 12000,
};

function postRequest(body: unknown) {
  return new Request("http://localhost/api/tenant/settings/reminders-review", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/tenant/settings/reminders-review", () => {
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

  it("422s on a payload that fails reminderReviewSettingsSchema", async () => {
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await POST(postRequest({ ...validPayload, avg_transaction_value_cents: -1 }));
    expect(res.status).toBe(422);
  });

  it("422s on an invalid review_url", async () => {
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await POST(postRequest({ ...validPayload, review_url: "not-a-url" }));
    expect(res.status).toBe(422);
  });

  it("updates the tenants row scoped to the caller's own tenant_id", async () => {
    mockGetUser = async () => ({ data: { user: mockUser } });
    updateResult = { error: null };
    const res = await POST(postRequest(validPayload));
    expect(res.status).toBe(200);
    expect(lastTable).toBe("tenants");
    expect(lastUpdatePayload).toEqual({
      voice_reminders_enabled: true,
      review_request_enabled: true,
      review_url: "https://reviews.example.com/acme",
      avg_transaction_value_cents: 12000,
    });
  });

  it("500s when the update fails", async () => {
    mockGetUser = async () => ({ data: { user: mockUser } });
    updateResult = { error: { message: "db down" } };
    const res = await POST(postRequest(validPayload));
    expect(res.status).toBe(500);
  });
});
