import { describe, expect, it, vi } from "vitest";

class RedirectSignal extends Error {
  constructor(public destination: string) {
    super(`NEXT_REDIRECT:${destination}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (destination: string) => {
    throw new RedirectSignal(destination);
  },
}));

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

let mockUser: unknown = null;
let tenantResult: unknown = { data: null, error: null };

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: mockUser } }) },
    from: vi.fn(() => chain(tenantResult)),
  }),
}));

const { requireTenantSession } = await import("./require-tenant-session");

async function redirectedTo(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    throw new Error("expected a redirect, none happened");
  } catch (error) {
    if (error instanceof RedirectSignal) return error.destination;
    throw error;
  }
}

describe("requireTenantSession", () => {
  it("redirects to /login with the next path when there is no user", async () => {
    mockUser = null;
    const dest = await redirectedTo(requireTenantSession("/dashboard/calls"));
    expect(dest).toBe(`/login?next=${encodeURIComponent("/dashboard/calls")}`);
  });

  it("redirects to the no_access toast when the caller has no tenant_id claim", async () => {
    mockUser = { id: "u1", app_metadata: { platform_admin: true } };
    const dest = await redirectedTo(requireTenantSession("/dashboard"));
    expect(dest).toBe("/?toast=no_access");
  });

  it("redirects to the no_access toast when the tenant_id claim doesn't resolve to a real tenant row", async () => {
    mockUser = { id: "u1", app_metadata: { tenant_id: "t1", role: "owner" } };
    tenantResult = { data: null, error: null };
    const dest = await redirectedTo(requireTenantSession("/dashboard"));
    expect(dest).toBe("/?toast=no_access");
  });

  it("returns the session, claims, and tenant row for a valid tenant member", async () => {
    mockUser = { id: "u1", app_metadata: { tenant_id: "t1", role: "owner" } };
    tenantResult = { data: { id: "t1", name: "Acme", status: "active" }, error: null };
    const result = await requireTenantSession("/dashboard");
    expect(result.claims.tenant_id).toBe("t1");
    expect(result.tenant).toEqual({ id: "t1", name: "Acme", status: "active" });
  });
});
