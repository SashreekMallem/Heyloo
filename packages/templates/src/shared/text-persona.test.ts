import { VERTICALS } from "@heyloo/canonical-types";
import { describe, expect, it } from "vitest";
import {
  CANCELLATION_POLICY_READOUT_FRAGMENT,
  CONSENT_ASK_FRAGMENT,
  IDENTITY_FALLBACK_FRAGMENT,
  WAITLIST_OFFER_FRAGMENT,
} from "./fragments.js";
import {
  buildTextSystemPrompt,
  TEXT_DISCLOSURE_LINE,
  TEXT_VERTICAL_INTROS,
} from "./text-persona.js";

describe("TEXT_DISCLOSURE_LINE", () => {
  it("carries the {{business_name}} token and is distinct from the voice disclosure (no recording claim)", () => {
    expect(TEXT_DISCLOSURE_LINE).toContain("{{business_name}}");
    expect(TEXT_DISCLOSURE_LINE.toLowerCase()).not.toContain("record");
    expect(TEXT_DISCLOSURE_LINE.toLowerCase()).toContain("ai assistant");
  });
});

describe("TEXT_VERTICAL_INTROS", () => {
  it("has an intro for every canonical vertical", () => {
    for (const vertical of VERTICALS) {
      expect(TEXT_VERTICAL_INTROS[vertical]).toBeTruthy();
      expect(TEXT_VERTICAL_INTROS[vertical].length).toBeGreaterThan(20);
    }
  });
});

describe("buildTextSystemPrompt", () => {
  it("reuses the shared policy fragments verbatim, never re-authoring them", () => {
    const prompt = buildTextSystemPrompt("dental");
    expect(prompt).toContain(CONSENT_ASK_FRAGMENT);
    expect(prompt).toContain(CANCELLATION_POLICY_READOUT_FRAGMENT);
    expect(prompt).toContain(IDENTITY_FALLBACK_FRAGMENT);
    expect(prompt).toContain(WAITLIST_OFFER_FRAGMENT);
    expect(prompt).toContain(TEXT_VERTICAL_INTROS.dental);
  });

  it("produces a different, vertical-appropriate intro per vertical", () => {
    expect(buildTextSystemPrompt("vet")).not.toEqual(buildTextSystemPrompt("motel"));
  });
});
