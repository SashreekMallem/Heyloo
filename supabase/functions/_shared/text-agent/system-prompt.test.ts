import { VERTICALS } from "@heyloo/canonical-types";
import {
  CANCELLATION_POLICY_READOUT_FRAGMENT,
  TEXT_DISCLOSURE_LINE as CANONICAL_TEXT_DISCLOSURE_LINE,
  TEXT_VERTICAL_INTROS as CANONICAL_TEXT_VERTICAL_INTROS,
  CONSENT_ASK_FRAGMENT,
  buildTextSystemPrompt as canonicalBuildTextSystemPrompt,
  ESCALATION_TRIGGERS_FRAGMENT,
  GIVE_UP_LADDER_FRAGMENT,
  IDENTITY_FALLBACK_FRAGMENT,
  WAITLIST_OFFER_FRAGMENT,
} from "@heyloo/templates";
import { describe, expect, it } from "vitest";
import {
  buildTextSystemPrompt,
  interpolate,
  TEXT_DISCLOSURE_LINE,
  TEXT_VERTICAL_INTROS,
} from "./system-prompt.js";

/**
 * This file (Node/Vitest-only, same pattern `_shared/schemas/
 * voice-tools.test.ts` uses for `@heyloo/canonical-types`) is the drift
 * guard `system-prompt.ts`'s own docstring promises: every string this
 * Deno-reachable module hand-mirrors from `packages/templates/src/shared/
 * text-persona.ts` (which itself reuses the shared policy fragments
 * verbatim) must stay byte-for-byte identical to the canonical source.
 */

describe("system-prompt.ts <-> @heyloo/templates parity", () => {
  it("TEXT_DISCLOSURE_LINE matches the canonical source", () => {
    expect(TEXT_DISCLOSURE_LINE).toBe(CANONICAL_TEXT_DISCLOSURE_LINE);
  });

  it("every vertical intro matches the canonical source", () => {
    for (const vertical of VERTICALS) {
      expect(TEXT_VERTICAL_INTROS[vertical]).toBe(CANONICAL_TEXT_VERTICAL_INTROS[vertical]);
    }
  });

  it("buildTextSystemPrompt produces the same composed prompt per vertical", () => {
    for (const vertical of VERTICALS) {
      expect(buildTextSystemPrompt(vertical)).toBe(canonicalBuildTextSystemPrompt(vertical));
    }
  });

  it("reuses every policy fragment verbatim (never re-authored)", () => {
    const prompt = buildTextSystemPrompt("dental");
    expect(prompt).toContain(CONSENT_ASK_FRAGMENT);
    expect(prompt).toContain(CANCELLATION_POLICY_READOUT_FRAGMENT);
    expect(prompt).toContain(IDENTITY_FALLBACK_FRAGMENT);
    expect(prompt).toContain(WAITLIST_OFFER_FRAGMENT);
    expect(prompt).toContain(ESCALATION_TRIGGERS_FRAGMENT);
    expect(prompt).toContain(GIVE_UP_LADDER_FRAGMENT);
  });
});

describe("interpolate", () => {
  it("substitutes known tokens and leaves unknown ones untouched", () => {
    expect(interpolate("Hi {{name}}, {{unknown}}", { name: "Alex" })).toBe("Hi Alex, {{unknown}}");
  });
});
