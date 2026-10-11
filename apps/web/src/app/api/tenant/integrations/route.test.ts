import { describe, expect, it, vi } from "vitest";

const selectCalls: string[] = [];

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in"]) {
    obj[method] = vi.fn((arg?: unknown) => {
      if (method === "select") selectCalls.push(String(arg));
      return obj;
    });
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
    auth: {
      getSession: () => Promise.resolve({ data: { session: mockSession } }),
      // AUTH-1 (docs/BUILD_NOTES.md): claims now come from `auth.getClaims()`,
      // not `session.user.app_metadata` — bridge it off the SAME mocked
      // session so every existing `mockSession` scenario above still
      // drives the route's authorization outcome unchanged.
      getClaims: () =>
        Promise.resolve({
          data: { claims: { app_metadata: mockSession?.user.app_metadata ?? {} } },
          error: null,
        }),
    },
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

  it("CONNECT-SAFE-1: a disconnected row with a failure reason reads as error (Needs reconnect)", async () => {
    mockSession = ownerSession();
    fromResult = {
      data: [
        {
          provider: "square",
          status: "disconnected",
          last_refreshed_at: "2026-09-01T00:00:00Z",
          last_error: "square 401 on booking push",
        },
        {
          provider: "google_calendar",
          status: "disconnected",
          last_refreshed_at: null,
          last_error: "tenant-initiated disconnect",
        },
        {
          provider: "shopmonkey",
          status: "disconnected",
          last_refreshed_at: null,
          last_error: null,
        },
      ],
      error: null,
    };
    const res = await GET();
    const body = (await res.json()) as { integrations: { provider: string; status: string }[] };
    const statusOf = (p: string) => body.integrations.find((i) => i.provider === p)?.status;
    expect(statusOf("square")).toBe("error");
    // The owner's own disconnect is not a failure.
    expect(statusOf("google_calendar")).toBe("disconnected");
    expect(statusOf("shopmonkey")).toBe("disconnected");
    expect(statusOf("ezyvet")).toBe("disconnected");
  });

  it("CONNECT-SAFE-1: marks Square/Shopmonkey/ezyVet unavailable (coming soon), connected or not; CAL-1: Google Calendar is available", async () => {
    mockSession = ownerSession();
    fromResult = {
      data: [
        { provider: "square", status: "connected", last_refreshed_at: null, last_error: null },
      ],
      error: null,
    };
    const res = await GET();
    const body = (await res.json()) as {
      integrations: { provider: string; status: string; available: boolean }[];
    };
    const availableOf = (p: string) => body.integrations.find((i) => i.provider === p)?.available;
    expect(availableOf("square")).toBe(false);
    expect(availableOf("shopmonkey")).toBe(false);
    expect(availableOf("ezyvet")).toBe(false);
    expect(availableOf("google_calendar")).toBe(true);
    // A connected row stays connected (and so stays disconnectable on the page).
    expect(body.integrations.find((i) => i.provider === "square")?.status).toBe("connected");
  });

  it("CAL-1: reads busy_synced_at and returns it as Google Calendar's last_checked_at only", async () => {
    mockSession = ownerSession();
    fromResult = {
      data: [
        {
          provider: "google_calendar",
          status: "connected",
          last_refreshed_at: "2026-10-11T11:00:00Z",
          last_error: null,
          busy_synced_at: "2026-10-11T12:03:00Z",
        },
        {
          provider: "square",
          status: "connected",
          last_refreshed_at: null,
          last_error: null,
          busy_synced_at: "2026-10-11T12:03:00Z",
        },
      ],
      error: null,
    };
    const res = await GET();
    const body = (await res.json()) as {
      integrations: { provider: string; last_checked_at: string | null }[];
    };
    const checkedOf = (p: string) =>
      body.integrations.find((i) => i.provider === p)?.last_checked_at;
    expect(checkedOf("google_calendar")).toBe("2026-10-11T12:03:00Z");
    expect(checkedOf("square")).toBeNull();
    expect(checkedOf("ezyvet")).toBeNull();
  });

  it("CAL-1b: flags a connected Google Calendar whose reads are failing (sync last_error prefix) — never the raw reason", async () => {
    mockSession = ownerSession();
    fromResult = {
      data: [
        {
          provider: "google_calendar",
          status: "connected",
          last_refreshed_at: null,
          last_error: "calendar busy sync: server (freeBusy 503)",
          busy_synced_at: "2026-10-11T12:03:00Z",
        },
        {
          provider: "square",
          status: "connected",
          last_refreshed_at: null,
          last_error: "calendar busy sync: looks the same but is not a calendar",
          busy_synced_at: null,
        },
      ],
      error: null,
    };
    const res = await GET();
    const body = (await res.json()) as {
      integrations: { provider: string; calendar_read_failing?: boolean }[];
    };
    const failingOf = (p: string) =>
      body.integrations.find((i) => i.provider === p)?.calendar_read_failing;
    expect(failingOf("google_calendar")).toBe(true);
    expect(failingOf("square")).toBe(false);
  });

  it("CAL-1b: a healthy, a disconnected or an owner-disconnected calendar is not 'failing'", async () => {
    for (const row of [
      { status: "connected", last_error: null },
      { status: "disconnected", last_error: "calendar busy sync: server (freeBusy 503)" },
      { status: "disconnected", last_error: "tenant-initiated disconnect" },
    ]) {
      mockSession = ownerSession();
      fromResult = {
        data: [
          {
            provider: "google_calendar",
            last_refreshed_at: null,
            busy_synced_at: null,
            ...row,
          },
        ],
        error: null,
      };
      const res = await GET();
      const body = (await res.json()) as {
        integrations: { provider: string; calendar_read_failing?: boolean }[];
      };
      expect(
        body.integrations.find((i) => i.provider === "google_calendar")?.calendar_read_failing,
      ).toBe(false);
    }
  });

  it("CAL-1: selects busy_synced_at (a column the migration grants to authenticated)", async () => {
    mockSession = ownerSession();
    fromResult = { data: [], error: null };
    selectCalls.length = 0;
    await GET();
    expect(selectCalls).toEqual([
      "provider, status, last_refreshed_at, last_error, busy_synced_at",
    ]);
  });

  it("marks can_manage false for a member role", async () => {
    mockSession = ownerSession({ role: "member" });
    fromResult = { data: [], error: null };
    const res = await GET();
    const body = (await res.json()) as { integrations: { can_manage: boolean }[] };
    expect(body.integrations.every((i) => i.can_manage === false)).toBe(true);
  });
});
