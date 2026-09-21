import { describe, expect, it, vi } from "vitest";

let mockUser: { id: string; app_metadata: Record<string, unknown> } | null = null;
let mockCode: string | null = "ABC123";
// AUTH-1 (docs/BUILD_NOTES.md): set only by the dedicated regression test
// below to decouple `getClaims()`'s answer from `getUser()`'s, proving the
// route honors the JWT-only claim rather than `user.app_metadata`.
let mockClaimsOverride: Record<string, unknown> | undefined;

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: mockUser } }),
      // AUTH-1 (docs/BUILD_NOTES.md): the route now reads claims via
      // `auth.getClaims()`, not `user.app_metadata` — bridge it off the
      // SAME mocked user by default, unless decoupled via
      // `mockClaimsOverride`.
      getClaims: async () => ({
        data: {
          claims: { app_metadata: mockClaimsOverride ?? mockUser?.app_metadata ?? {} },
        },
        error: null,
      }),
    },
  }),
}));

vi.mock("../_lib/ensure-referral-link", () => ({
  ensurePartnerReferralLink: async () => mockCode,
}));

const { POST } = await import("./route");

describe("POST /api/partner/ensure-link", () => {
  it("401s when unauthenticated", async () => {
    mockUser = null;
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it("403s for a user with no referral_partner_id claim", async () => {
    mockUser = { id: "u1", app_metadata: {} };
    const res = await POST();
    expect(res.status).toBe(403);
  });

  it("returns the code for an authenticated partner", async () => {
    mockUser = { id: "u1", app_metadata: { referral_partner_id: "p1" } };
    mockCode = "ABC123";
    const res = await POST();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("ABC123");
  });

  it("500s when the link cannot be created", async () => {
    mockUser = { id: "u1", app_metadata: { referral_partner_id: "p1" } };
    mockCode = null;
    const res = await POST();
    expect(res.status).toBe(500);
  });

  it("AUTH-1 regression: honors a referral_partner_id claim present ONLY in the JWT (auth.getClaims()), absent from user.app_metadata", async () => {
    mockUser = { id: "u1", app_metadata: {} };
    mockClaimsOverride = { referral_partner_id: "p1" };
    mockCode = "ABC123";
    const res = await POST();
    expect(res.status).toBe(200);
    mockClaimsOverride = undefined;
  });

  it("AUTH-1 regression: 403s when the JWT's own claims carry no referral_partner_id, even if user.app_metadata (stale) has one", async () => {
    mockUser = { id: "u1", app_metadata: { referral_partner_id: "stale-partner" } };
    mockClaimsOverride = {};
    const res = await POST();
    expect(res.status).toBe(403);
    mockClaimsOverride = undefined;
  });
});
