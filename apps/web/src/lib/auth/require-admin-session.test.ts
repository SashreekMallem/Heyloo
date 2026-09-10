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

let mockUser: unknown = null;
let aalResult: unknown = { data: { currentLevel: "aal1", nextLevel: "aal2" } };
let factorsResult: unknown = { data: { totp: [] } };

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: mockUser } }),
      mfa: {
        getAuthenticatorAssuranceLevel: () => Promise.resolve(aalResult),
        listFactors: () => Promise.resolve(factorsResult),
      },
    },
  }),
}));

const { requireAdminSession } = await import("./require-admin-session");

async function redirectedTo(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    throw new Error("expected a redirect, none happened");
  } catch (error) {
    if (error instanceof RedirectSignal) return error.destination;
    throw error;
  }
}

describe("requireAdminSession", () => {
  it("redirects to /login with the next path when there is no user", async () => {
    mockUser = null;
    const dest = await redirectedTo(requireAdminSession("/cockpit/tenants"));
    expect(dest).toBe(`/login?next=${encodeURIComponent("/cockpit/tenants")}`);
  });

  it("redirects to the no_access toast when the caller has no platform_admin claim", async () => {
    mockUser = { id: "u1", app_metadata: { tenant_id: "t1", role: "owner" } };
    const dest = await redirectedTo(requireAdminSession("/cockpit"));
    expect(dest).toBe("/?toast=no_access");
  });

  it("redirects to MFA enrollment when platform_admin has no verified TOTP factor", async () => {
    mockUser = { id: "u1", app_metadata: { platform_admin: true } };
    factorsResult = { data: { totp: [] } };
    const dest = await redirectedTo(requireAdminSession("/cockpit"));
    expect(dest).toBe("/mfa/enroll");
  });

  it("redirects to the AAL2 challenge when enrolled but the session hasn't stepped up", async () => {
    mockUser = { id: "u1", app_metadata: { platform_admin: true } };
    factorsResult = { data: { totp: [{ status: "verified" }] } };
    aalResult = { data: { currentLevel: "aal1", nextLevel: "aal2" } };
    const dest = await redirectedTo(requireAdminSession("/cockpit/tenants"));
    expect(dest).toBe(`/mfa/challenge?next=${encodeURIComponent("/cockpit/tenants")}`);
  });

  it("returns the session for a platform_admin with a verified factor and an AAL2 session", async () => {
    mockUser = { id: "u1", app_metadata: { platform_admin: true } };
    factorsResult = { data: { totp: [{ status: "verified" }] } };
    aalResult = { data: { currentLevel: "aal2", nextLevel: "aal2" } };
    const result = await requireAdminSession("/cockpit");
    expect(result.claims.platform_admin).toBe(true);
  });
});
