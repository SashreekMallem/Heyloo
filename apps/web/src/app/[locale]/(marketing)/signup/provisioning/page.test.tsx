import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));

vi.mock("@/lib/auth/require-tenant-session", () => ({
  requireTenantSession: async () => ({
    supabase: {},
    tenant: { id: "t1", status: "active" },
  }),
}));

let readiness = { published: false, number: null as string | null, ready: false };
vi.mock("@/lib/signup/line-readiness", () => ({ getLineReadiness: async () => readiness }));
vi.mock("@/components/signup/provisioning-client", () => ({
  ProvisioningClient: () => null,
}));

const { default: SignupProvisioningPage } = await import("./page");

describe("/signup/provisioning gate (SIGNUP-BILL-FIX C)", () => {
  beforeEach(() => {
    redirect.mockClear();
  });

  it("does NOT skip the timeline just because tenants.status is 'active' (Stripe confirmed payment, saga still running)", async () => {
    readiness = { published: false, number: null, ready: false };
    const el = await SignupProvisioningPage();
    expect(redirect).not.toHaveBeenCalled();
    expect(el).toBeTruthy();
  });

  it("stays on the timeline when the number exists but the agent is not published yet", async () => {
    readiness = { published: false, number: "+15551230000", ready: false };
    await SignupProvisioningPage();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("moves on to forwarding once publish_agent succeeded and the number exists", async () => {
    readiness = { published: true, number: "+15551230000", ready: true };
    await expect(SignupProvisioningPage()).rejects.toThrow("NEXT_REDIRECT:/signup/forwarding");
  });
});
