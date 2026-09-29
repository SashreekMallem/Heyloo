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

  it("DELETE clears the draft cookie (called once the tenant is active)", async () => {
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(cookieDelete).toHaveBeenCalledWith(SIGNUP_DRAFT_COOKIE.name);
  });
});
