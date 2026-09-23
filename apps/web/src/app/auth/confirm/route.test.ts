import { describe, expect, it, vi } from "vitest";

let mockVerifyOtp: (args: { type: string; token_hash: string }) => Promise<{ error: unknown }> =
  async () => ({ error: null });

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: {
      verifyOtp: (args: { type: string; token_hash: string }) => mockVerifyOtp(args),
    },
  }),
}));

const { GET } = await import("./route");

function req(search: string) {
  return new Request(`https://app.example.com/auth/confirm${search}`);
}

describe("GET /auth/confirm", () => {
  it("verifies the OTP and redirects to next on success", async () => {
    let captured: unknown;
    mockVerifyOtp = async (args) => {
      captured = args;
      return { error: null };
    };
    const res = await GET(req("?token_hash=abc123&type=invite&next=%2Fdashboard"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.example.com/dashboard");
    expect(captured).toEqual({ type: "invite", token_hash: "abc123" });
  });

  it("defaults next to /dashboard when absent", async () => {
    mockVerifyOtp = async () => ({ error: null });
    const res = await GET(req("?token_hash=abc123&type=signup"));
    expect(res.headers.get("location")).toBe("https://app.example.com/dashboard");
  });

  it("redirects recovery links to the caller-supplied next (e.g. reset-password/confirm)", async () => {
    mockVerifyOtp = async () => ({ error: null });
    const res = await GET(req("?token_hash=abc123&type=recovery&next=%2Freset-password%2Fconfirm"));
    expect(res.headers.get("location")).toBe("https://app.example.com/reset-password/confirm");
  });

  it("redirects to /login with an error toast when verifyOtp fails (fails closed, no session)", async () => {
    mockVerifyOtp = async () => ({ error: new Error("Token has expired or is invalid") });
    const res = await GET(req("?token_hash=abc123&type=invite&next=%2Fdashboard"));
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("toast")).toBe("confirm_failed");
  });

  it("rejects a missing token_hash/type without calling verifyOtp", async () => {
    const spy = vi.fn();
    mockVerifyOtp = async (args) => {
      spy(args);
      return { error: null };
    };
    const res = await GET(req("?next=%2Fdashboard"));
    expect(spy).not.toHaveBeenCalled();
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
  });

  it("rejects an unknown type value", async () => {
    const spy = vi.fn();
    mockVerifyOtp = async (args) => {
      spy(args);
      return { error: null };
    };
    const res = await GET(req("?token_hash=abc123&type=not_a_real_type"));
    expect(spy).not.toHaveBeenCalled();
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/login");
  });

  it("never treats an absolute/external next as a redirect target (open-redirect guard)", async () => {
    mockVerifyOtp = async () => ({ error: null });
    const res = await GET(
      req("?token_hash=abc123&type=invite&next=https%3A%2F%2Fevil.example.com"),
    );
    expect(res.headers.get("location")).toBe("https://app.example.com/dashboard");
  });

  it("never treats a protocol-relative next as a redirect target (open-redirect guard)", async () => {
    mockVerifyOtp = async () => ({ error: null });
    const res = await GET(req("?token_hash=abc123&type=invite&next=%2F%2Fevil.example.com"));
    expect(res.headers.get("location")).toBe("https://app.example.com/dashboard");
  });
});
