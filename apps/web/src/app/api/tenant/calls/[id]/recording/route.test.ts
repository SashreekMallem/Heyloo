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

function makeFrom(queue: Record<string, unknown[]>) {
  return vi.fn((table: string) => {
    const q = queue[table];
    const result = q?.length ? q.shift() : { data: null, error: null };
    return chain(result);
  });
}

const mockUser = { id: "u1", app_metadata: { tenant_id: "t1", role: "owner" } };

let serverQueue: Record<string, unknown[]> = {};
let mockGetUser: () => Promise<{ data: { user: unknown } }> = async () => ({
  data: { user: null },
});
let createSignedUrlMock: (
  ...args: [path: string, ttl: number]
) => Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }> = vi.fn(
  async (_path: string, _ttl: number) => ({
    data: {
      signedUrl: "https://example.supabase.co/storage/v1/object/sign/recordings/x?token=abc",
    },
    error: null,
  }),
);

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: {
      getUser: () => mockGetUser(),
      // AUTH-1 (docs/BUILD_NOTES.md): the route reads claims via
      // `auth.getClaims()`, not `user.app_metadata` — bridge it off the
      // SAME mocked user so every `mockGetUser` scenario below still
      // drives the route's authorization outcome unchanged.
      getClaims: async () => {
        const { data } = await mockGetUser();
        const u = data.user as { app_metadata?: unknown } | null;
        return { data: { claims: { app_metadata: u?.app_metadata ?? {} } }, error: null };
      },
    },
    from: makeFrom(serverQueue),
  }),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createSupabaseServiceRoleServerClient: () => ({
    storage: {
      from: (_bucket: string) => ({
        createSignedUrl: (path: string, ttl: number) => createSignedUrlMock(path, ttl),
      }),
    },
  }),
}));

const { GET } = await import("./route");

function req(id: string, query?: string) {
  return new Request(`http://localhost/api/tenant/calls/${id}/recording${query ?? ""}`);
}

describe("GET /api/tenant/calls/[id]/recording", () => {
  it("401s when unauthenticated", async () => {
    serverQueue = {};
    mockGetUser = async () => ({ data: { user: null } });
    const res = await GET(req("c1"), { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(401);
  });

  it("403s when the caller has no tenant_id claim", async () => {
    serverQueue = {};
    mockGetUser = async () => ({ data: { user: { id: "u1", app_metadata: {} } } });
    const res = await GET(req("c1"), { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(403);
  });

  it("404s for another tenant's call id (RLS-filtered query returns no row)", async () => {
    serverQueue = { call_logs: [{ data: null, error: null }] };
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await GET(req("c1"), { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("404s when the call has no recording yet", async () => {
    serverQueue = {
      call_logs: [
        { data: { id: "c1", recording_url: null, stereo_recording_url: null }, error: null },
      ],
    };
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await GET(req("c1"), { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "recording_not_available" });
  });

  it("returns a signed URL shape for a ready recording, scoped to the caller's tenant", async () => {
    serverQueue = {
      call_logs: [
        {
          data: {
            id: "c1",
            recording_url: "b2efae9d-8309-46d6-a950-31d683616cdc/call_abc.wav",
            stereo_recording_url: "b2efae9d-8309-46d6-a950-31d683616cdc/call_abc_stereo.wav",
          },
          error: null,
        },
      ],
    };
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await GET(req("c1"), { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toMatch(/^https:\/\//);
    expect(body.expires_in).toBe(300);
    expect(createSignedUrlMock).toHaveBeenCalledWith(
      "b2efae9d-8309-46d6-a950-31d683616cdc/call_abc.wav",
      300,
    );
  });

  it("signs the stereo object when ?channel=stereo is requested", async () => {
    serverQueue = {
      call_logs: [
        {
          data: {
            id: "c1",
            recording_url: "t1/call_abc.wav",
            stereo_recording_url: "t1/call_abc_stereo.wav",
          },
          error: null,
        },
      ],
    };
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await GET(req("c1", "?channel=stereo"), {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(res.status).toBe(200);
    expect(createSignedUrlMock).toHaveBeenCalledWith("t1/call_abc_stereo.wav", 300);
  });

  it("502s when signing fails", async () => {
    serverQueue = {
      call_logs: [{ data: { id: "c1", recording_url: "t1/x.wav" }, error: null }],
    };
    mockGetUser = async () => ({ data: { user: mockUser } });
    createSignedUrlMock = vi.fn(async () => ({ data: null, error: { message: "boom" } }));
    const res = await GET(req("c1"), { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(502);
  });
});
