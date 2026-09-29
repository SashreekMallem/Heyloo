import { describe, expect, it } from "vitest";
import { scenariosForVertical } from "./test-scenarios.ts";
import type { Vertical } from "./vertical-defaults.ts";

const VERTICALS: Vertical[] = [
  "auto",
  "vet",
  "legal",
  "dental",
  "real_estate",
  "motel",
  "restaurant",
  "generic",
];

describe("test scenarios (DISCLOSE-1)", () => {
  it("the dental emergency persona accepts the 911/ER referral the second time it is given, so Retell's loop detector no longer aborts the scenario before it can be judged", () => {
    const scenario = scenariosForVertical("dental").find((s) => s.id === "emergency_triage");
    expect(scenario?.personaPrompt).toMatch(/push back only ONCE/);
    expect(scenario?.personaPrompt).toMatch(/second time to go to the ER or call 911, accept it/);
    expect(scenario?.personaPrompt).toMatch(/never ask the same question a third time/);
    // Intent unchanged: still a take_message record under the persona's own number.
    expect(scenario?.writeIntent).toBe("take_message");
    expect(scenario?.expectedPhone).toBe("+15552010198");
    expect(scenario?.personaPrompt).toContain("555-201-0198");
  });

  it("every vertical's returning_caller scenario still simulates the seeded returning caller's number (the caller_greeting path)", () => {
    for (const vertical of VERTICALS) {
      const returning = scenariosForVertical(vertical).find((s) => s.id === "returning_caller");
      expect(returning?.testCallerNumber, vertical).toBe("+15552010288");
    }
  });

  it("scenario ids stay unique within each vertical", () => {
    for (const vertical of VERTICALS) {
      const ids = scenariosForVertical(vertical).map((s) => s.id);
      expect(new Set(ids).size, vertical).toBe(ids.length);
    }
  });
});
