import { describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit", "gte", "lt", "or", "ilike"]) {
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
let customersResult: unknown = { data: [], error: null };
let lastChain: Record<string, unknown> | null = null;
const from = vi.fn((table: string) => {
  const c = chain(table === "customers" ? customersResult : callLogsResult);
  if (table === "call_logs") lastChain = c;
  return c;
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: {
      getUser: () => mockGetUser(),
      // AUTH-1 (docs/BUILD_NOTES.md): the route now reads claims via
      // `auth.getClaims()`, not `user.app_metadata` — bridge it off the
      // SAME mocked user so every existing `mockGetUser` scenario above
      // still drives the route's authorization outcome unchanged.
      getClaims: async () => {
        const { data } = await mockGetUser();
        const u = data.user as { app_metadata?: unknown } | null;
        return { data: { claims: { app_metadata: u?.app_metadata ?? {} } }, error: null };
      },
    },
    from,
  }),
}));

const { GET } = await import("./route");

function exportRequest(tenantId: string | null, extra: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/tenant/calls/export");
  if (tenantId !== null) url.searchParams.set("tenant_id", tenantId);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
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

  it("filters call_logs to voice channels only (excludes sms/web_chat shadow rows, CHANNELS-2 item 3)", async () => {
    mockGetUser = async () => ({ data: { user: mockUser } });
    callLogsResult = { data: [], error: null };
    from.mockClear();

    await GET(exportRequest("t1"));
    expect(lastChain).not.toBeNull();
    // biome-ignore lint/style/noNonNullAssertion: asserted above.
    const inMock = lastChain!["in"] as ReturnType<typeof vi.fn>;
    expect(inMock).toHaveBeenCalledWith("channel", ["phone", "web_voice"]);
  });

  it("applies the page's classification and date-range filters to the export (QA-1 F-17)", async () => {
    mockGetUser = async () => ({ data: { user: mockUser } });
    callLogsResult = { data: [], error: null };
    from.mockClear();

    await GET(
      exportRequest("t1", {
        classification: "emergency",
        started_after: "2026-09-29T04:00:00.000Z",
        started_before: "2026-09-30T04:00:00.000Z",
      }),
    );
    // biome-ignore lint/style/noNonNullAssertion: asserted by the export having queried call_logs.
    const c = lastChain!;
    expect(c["eq"]).toHaveBeenCalledWith("classification", "emergency");
    expect(c["gte"]).toHaveBeenCalledWith("started_at", "2026-09-29T04:00:00.000Z");
    expect(c["lt"]).toHaveBeenCalledWith("started_at", "2026-09-30T04:00:00.000Z");
  });

  it("ignores an unknown classification instead of passing it through", async () => {
    mockGetUser = async () => ({ data: { user: mockUser } });
    callLogsResult = { data: [], error: null };
    from.mockClear();
    await GET(exportRequest("t1", { classification: "x,y" }));
    // biome-ignore lint/style/noNonNullAssertion: asserted by the export having queried call_logs.
    const eq = lastChain!["eq"] as ReturnType<typeof vi.fn>;
    expect(eq).not.toHaveBeenCalledWith("classification", expect.anything());
  });

  it("searches by digits and by customer name -> E.164, using a safe .or() built from digits/E.164 only", async () => {
    mockGetUser = async () => ({ data: { user: mockUser } });
    callLogsResult = { data: [], error: null };
    customersResult = { data: [{ phone_e164: "+15552019010" }], error: null };
    from.mockClear();
    await GET(exportRequest("t1", { q: "Jamie 555" }));
    // biome-ignore lint/style/noNonNullAssertion: asserted by the export having queried call_logs.
    const or = lastChain!["or"] as ReturnType<typeof vi.fn>;
    expect(or).toHaveBeenCalledWith("caller_number.ilike.%555%,caller_number.in.(+15552019010)");
  });

  it("exports only the header for a search that can match nothing (never everything)", async () => {
    mockGetUser = async () => ({ data: { user: mockUser } });
    callLogsResult = {
      data: [
        {
          started_at: "2026-09-01T00:00:00Z",
          caller_number: "+15551234567",
          classification: "new_booking",
          duration_seconds: 5,
          outcome: "x",
        },
      ],
      error: null,
    };
    customersResult = { data: [], error: null };
    const res = await GET(exportRequest("t1", { q: "Nobody" }));
    expect((await res.text()).split("\n")).toHaveLength(1);
  });

  it("neutralises formula-injection in caller-influenced cells but keeps E.164 numbers (QA-1 F-17)", async () => {
    mockGetUser = async () => ({ data: { user: mockUser } });
    callLogsResult = {
      data: [
        {
          started_at: "2026-09-01T00:00:00Z",
          caller_number: "=1+1",
          classification: "new_booking",
          duration_seconds: 5,
          outcome: "@SUM(A1)",
        },
        {
          started_at: "2026-09-01T00:00:00Z",
          caller_number: "+15551234567",
          classification: "new_booking",
          duration_seconds: 5,
          outcome: "booked",
        },
      ],
      error: null,
    };
    const body = await (await GET(exportRequest("t1"))).text();
    expect(body).toContain('"\'=1+1"');
    expect(body).toContain('"\'@SUM(A1)"');
    expect(body).toContain('"+15551234567"');
  });
});
