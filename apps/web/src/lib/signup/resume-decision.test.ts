import { describe, expect, it } from "vitest";
import { decideSignupResume, type ResumeInput } from "./resume-decision";

const draft = { business_type: "auto" as const, business_name: "Joe's Garage" };
const base: ResumeInput = {
  hasSession: true,
  tenant: null,
  draft,
  lineReady: false,
  plan: { annual: false, white_glove: true },
};

describe("decideSignupResume", () => {
  it("sends a visitor with no session to log in and back", () => {
    expect(decideSignupResume({ ...base, hasSession: false })).toEqual({
      kind: "redirect",
      to: "/login?next=%2Fsignup%2Fresume",
    });
  });

  it("confirmed, no tenant yet: resumes into checkout with the saved business name and plan (not /?toast=no_access)", () => {
    expect(decideSignupResume(base)).toEqual({
      kind: "checkout",
      annual: false,
      whiteGlove: true,
      businessName: "Joe's Garage",
    });
  });

  it("a tenant that never paid (trialing) goes back to checkout", () => {
    expect(decideSignupResume({ ...base, tenant: { status: "trialing" } }).kind).toBe("checkout");
  });

  it("no tenant and no draft anywhere starts the wizard over", () => {
    expect(decideSignupResume({ ...base, draft: null })).toEqual({
      kind: "redirect",
      to: "/signup",
    });
  });

  it("paid but the line is not live yet: the provisioning timeline", () => {
    expect(decideSignupResume({ ...base, tenant: { status: "active" }, lineReady: false })).toEqual(
      {
        kind: "redirect",
        to: "/signup/provisioning",
      },
    );
  });

  it("an established tenant goes to the dashboard", () => {
    expect(decideSignupResume({ ...base, tenant: { status: "active" }, lineReady: true })).toEqual({
      kind: "redirect",
      to: "/dashboard",
    });
    expect(decideSignupResume({ ...base, tenant: { status: "past_due" } }).kind).toBe("redirect");
  });
});
