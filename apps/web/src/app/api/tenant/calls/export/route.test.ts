import { describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit"]) {
    obj[method] = vi.fn(() => obj);
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

const mockUser = { id: "u1", app_metadata: { tenant_id: "t1", role: "owner" } };

let mockGetUser: () => Promise<{ data: { user: unknown } }> = async () => ({
  data: { user: null },
});
let callLogsResult: unknown = { data: [], error: null };
const from = vi.fn((_table: string) => chain(callLogsResult));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: { getUser: () => mockGetUser() },
    from,
  }),
}));

const { GET } = await import("./route");

function exportRequest(tenantId: string | null) {
  const url = new URL("http://localhost/api/tenant/calls/export");
  if (tenantId !== null) url.searchParams.set("tenant_id", tenantId);
  return new Request(url);
}

describe("GET /api/tenant/calls/export", () => {
  it("401s when unauthenticated", async () => {
    mockGetUser = async () => ({ data: { user: null } });
    const res = await GET(exportRequest("t1"));
    expect(res.status).toBe(401);
  });

  it("403s when tenant_id is missing from the query string", async () => {
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await GET(exportRequest(null));
    expect(res.status).toBe(403);
  });

  it("403s when the requested tenant_id doesn't match the caller's own tenant_id claim", async () => {
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await GET(exportRequest("someone-elses-tenant"));
    expect(res.status).toBe(403);
  });

  it("streams a CSV scoped to the caller's own tenant_id", async () => {
    mockGetUser = async () => ({ data: { user: mockUser } });
    callLogsResult = {
      data: [
        {
          started_at: "2026-09-01T00:00:00Z",
          caller_number: "+15551234567",
          classification: "booking",
          duration_seconds: 120,
          outcome: "booked",
        },
      ],
      error: null,
    };
    from.mockClear();

    const res = await GET(exportRequest("t1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv");
    const body = await res.text();
    expect(body).toContain("started_at,caller_number,classification,duration_seconds,outcome");
    expect(body).toContain("+15551234567");
    expect(from).toHaveBeenCalledWith("call_logs");
  });
});
