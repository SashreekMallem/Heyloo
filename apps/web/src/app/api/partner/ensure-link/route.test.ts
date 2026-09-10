import { describe, expect, it, vi } from "vitest";

let mockUser: { id: string; app_metadata: Record<string, unknown> } | null = null;
let mockCode: string | null = "ABC123";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mockUser } }) },
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
});
