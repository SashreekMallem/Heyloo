import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));

let phoneRow: { e164: string; forwarding_verified_at: string | null } | null = null;
const supabase = {
  from: () => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is"]) chain[m] = () => chain;
    chain["maybeSingle"] = () => Promise.resolve({ data: phoneRow });
    return chain;
  },
};
vi.mock("@/lib/auth/require-tenant-session", () => ({
  requireTenantSession: async () => ({ supabase, tenant: { id: "t1", status: "active" } }),
}));

let readiness = { published: false, number: null as string | null, ready: false };
vi.mock("@/lib/signup/line-readiness", () => ({ getLineReadiness: async () => readiness }));
vi.mock("@/components/phone-setup/phone-setup-wizard", () => ({ PhoneSetupWizard: () => null }));

const { default: SignupForwardingPage } = await import("./page");

function findWizardProps(node: unknown): { forwardingNumber?: string } | null {
  if (!node || typeof node !== "object") return null;
  const el = node as { props?: Record<string, unknown> };
  if (el.props && "forwardingNumber" in el.props) return el.props as { forwardingNumber?: string };
  const children = el.props?.["children"];
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findWizardProps(child);
    if (found) return found;
  }
  return null;
}

describe("/signup/forwarding gate (SIGNUP-BILL-FIX C)", () => {
  beforeEach(() => {
    redirect.mockClear();
  });

  it("paid tenant whose number does not exist yet goes back to the timeline instead of rendering '*71' with nothing", async () => {
    readiness = { published: false, number: null, ready: false };
    phoneRow = null;
    await expect(SignupForwardingPage()).rejects.toThrow("NEXT_REDIRECT:/signup/provisioning");
  });

  it("a number without a published agent is not ready either", async () => {
    readiness = { published: false, number: "+15551230000", ready: false };
    phoneRow = { e164: "+15551230000", forwarding_verified_at: null };
    await expect(SignupForwardingPage()).rejects.toThrow("NEXT_REDIRECT:/signup/provisioning");
  });

  it("renders the wizard with the real number once the line is live", async () => {
    readiness = { published: true, number: "+15551230000", ready: true };
    phoneRow = { e164: "+15551230000", forwarding_verified_at: null };
    const el = await SignupForwardingPage();
    expect(redirect).not.toHaveBeenCalled();
    expect(findWizardProps(el)?.forwardingNumber).toBe("+15551230000");
  });
});
