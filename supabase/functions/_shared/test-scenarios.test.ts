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

  it("F-DENTAL-MSG-1 / F-LEGAL-CANCEL-1: leave-a-message (dental) and cancel-a-consult (legal) scenarios exist and must end in a take_message record", () => {
    const leave = scenariosForVertical("dental").find((s) => s.id === "leave_message");
    expect(leave?.writeIntent).toBe("take_message");
    expect(leave?.expectedPhone).toBe("+15552010197");
    expect(leave?.personaPrompt).toContain("555-201-0197");
    const cancel = scenariosForVertical("legal").find((s) => s.id === "cancel_consult");
    expect(cancel?.writeIntent).toBe("take_message");
    expect(cancel?.expectedPhone).toBe("+15552010165");
    expect(cancel?.personaPrompt).toContain("555-201-0165");
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
