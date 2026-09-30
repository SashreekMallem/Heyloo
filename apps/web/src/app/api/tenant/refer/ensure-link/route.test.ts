import { beforeEach, describe, expect, it, vi } from "vitest";

let mockUser: { id: string; email: string } | null = null;
let mockClaims: Record<string, unknown> = {};
const serviceFrom = vi.fn();
const ensureLink = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: mockUser } }),
      getClaims: async () => ({ data: { claims: { app_metadata: mockClaims } }, error: null }),
    },
  }),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  createSupabaseServiceRoleServerClient: () => ({ from: serviceFrom }),
}));
vi.mock("@/app/api/partner/_lib/ensure-referral-link", () => ({
  ensurePartnerReferralLink: (id: string) => ensureLink(id),
}));

const { POST } = await import("./route");

/** Partner already enrolled; funnel queries return empty. */
function serviceWithExistingPartner() {
  serviceFrom.mockImplementation((table: string) => {
    if (table === "referral_partners") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: "partner-1", ytd_payout_cents: 0, w9_status: "not_submitted" },
            }),
          }),
        }),
        insert: vi.fn(),
      };
    }
    return { select: () => ({ eq: async () => ({ data: [] }) }) };
  });
}

describe("POST /api/tenant/refer/ensure-link (SEC-11)", () => {
  beforeEach(() => {
    serviceFrom.mockReset();
    ensureLink.mockReset();
    ensureLink.mockResolvedValue("ABCD2345");
    mockUser = null;
    mockClaims = {};
  });

  it("401s when unauthenticated", async () => {
    const res = await POST();
    expect(res.status).toBe(401);
    expect(serviceFrom).not.toHaveBeenCalled();
  });

  it("403s a signed-in user with no tenant and never touches the service role", async () => {
    mockUser = { id: "u1", email: "u@example.com" };
    const res = await POST();
    expect(res.status).toBe(403);
    expect(serviceFrom).not.toHaveBeenCalled();
  });

  it("403s a plain member and never touches the service role", async () => {
    mockUser = { id: "u1", email: "u@example.com" };
    mockClaims = { tenant_id: "t1", role: "member" };
    const res = await POST();
    expect(res.status).toBe(403);
    expect(serviceFrom).not.toHaveBeenCalled();
  });

  it.each(["owner", "admin"])("lets a tenant %s in and returns the code", async (role) => {
    mockUser = { id: "u1", email: "u@example.com" };
    mockClaims = { tenant_id: "t1", role };
    serviceWithExistingPartner();
    const res = await POST();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; partner_id: string };
    expect(body.code).toBe("ABCD2345");
    expect(body.partner_id).toBe("partner-1");
    expect(ensureLink).toHaveBeenCalledWith("partner-1");
  });

  it("500s when no link could be created", async () => {
    mockUser = { id: "u1", email: "u@example.com" };
    mockClaims = { tenant_id: "t1", role: "owner" };
    ensureLink.mockResolvedValue(null);
    serviceWithExistingPartner();
    const res = await POST();
    expect(res.status).toBe(500);
  });
});
