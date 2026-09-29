import { describe, expect, it } from "vitest";
import { encodeSignupDraft } from "./draft-cookie";
import { resolveSignupDraft } from "./resolve-draft";
import {
  buildSignupUserMetadata,
  draftFromUserMetadata,
  planFromUserMetadata,
} from "./user-metadata";

Object.assign(process.env, { SIGNUP_DRAFT_SECRET: "test-signup-draft-secret" });

describe("signup user metadata", () => {
  const draft = { business_type: "auto" as const, business_name: "Joe's Garage" };

  it("round-trips the wizard state (vertical, business name, plan)", () => {
    const meta = buildSignupUserMetadata({
      ownerName: "Joe",
      draft,
      plan: { annual: true, white_glove: false },
    });
    expect(meta["owner_name"]).toBe("Joe");
    expect(draftFromUserMetadata(meta)).toEqual(draft);
    expect(planFromUserMetadata(meta)).toEqual({ annual: true, white_glove: false });
  });

  it("rejects a tampered or malformed draft, and defaults the plan to no add-ons", () => {
    expect(
      draftFromUserMetadata({ signup_draft: { business_type: "casino", business_name: "x" } }),
    ).toBeNull();
    expect(
      draftFromUserMetadata({ signup_draft: { business_type: "auto", business_name: "" } }),
    ).toBeNull();
    expect(draftFromUserMetadata(null)).toBeNull();
    expect(planFromUserMetadata(undefined)).toEqual({ annual: false, white_glove: false });
    expect(planFromUserMetadata({ signup_plan: { white_glove: "yes" } })).toEqual({
      annual: false,
      white_glove: false,
    });
  });
});

describe("resolveSignupDraft", () => {
  const meta = { signup_draft: { business_type: "vet", business_name: "Paws" } };

  it("prefers the signed cookie", () => {
    const cookie = encodeSignupDraft({ business_type: "auto", business_name: "Joe's Garage" });
    expect(resolveSignupDraft(cookie, { user_metadata: meta })).toMatchObject({
      business_type: "auto",
      business_name: "Joe's Garage",
    });
  });

  it("falls back to the copy on the user when the cookie is missing or forged", () => {
    expect(resolveSignupDraft(undefined, { user_metadata: meta })).toEqual({
      business_type: "vet",
      business_name: "Paws",
    });
    expect(resolveSignupDraft("forged.payload", { user_metadata: meta })?.business_name).toBe(
      "Paws",
    );
  });

  it("is null with neither", () => {
    expect(resolveSignupDraft(undefined, null)).toBeNull();
    expect(resolveSignupDraft(undefined, { user_metadata: {} })).toBeNull();
  });
});
