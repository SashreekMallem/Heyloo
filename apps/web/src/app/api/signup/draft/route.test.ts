import { describe, expect, it, vi } from "vitest";
import { SIGNUP_DRAFT_COOKIE } from "@/lib/signup/draft-cookie";

Object.assign(process.env, { SIGNUP_DRAFT_SECRET: "test-signup-draft-secret" });

const cookieSet = vi.fn();
const cookieDelete = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: cookieSet, delete: cookieDelete }),
}));

const { POST, DELETE } = await import("./route");

describe("/api/signup/draft", () => {
  it("POST writes the signed draft cookie with a TTL that outlives the trip to Stripe and back", async () => {
    const res = await POST(
      new Request("http://localhost/api/signup/draft", {
        method: "POST",
        body: JSON.stringify({ business_type: "auto", business_name: "Joe's Garage" }),
      }),
    );
    expect(res.status).toBe(200);
    const [name, , options] = cookieSet.mock.calls[0] as [string, string, { maxAge: number }];
    expect(name).toBe(SIGNUP_DRAFT_COOKIE.name);
    expect(options.maxAge).toBeGreaterThanOrEqual(6 * 60 * 60);
  });

  it("SEC-16: stores a UUID demo_id, and rejects a non-UUID or oversized one with 422 (no cookie written)", async () => {
    cookieSet.mockClear();
    const post = (demo_id: unknown) =>
      POST(
        new Request("http://localhost/api/signup/draft", {
          method: "POST",
          body: JSON.stringify({ business_type: "auto", business_name: "Joe's Garage", demo_id }),
        }),
      );
    expect((await post("0b0a3f8e-5c1a-4f57-9a44-0d6c3b1d9a11")).status).toBe(200);
    expect(cookieSet).toHaveBeenCalledTimes(1);
    cookieSet.mockClear();
    expect((await post("d".repeat(20_000))).status).toBe(422);
    expect((await post("not-a-uuid")).status).toBe(422);
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it("DELETE clears the draft cookie (called once the tenant is active)", async () => {
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(cookieDelete).toHaveBeenCalledWith(SIGNUP_DRAFT_COOKIE.name);
  });
});
