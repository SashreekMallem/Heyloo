import { describe, expect, it } from "vitest";
import {
  CALL_CLASSIFICATION_LABELS,
  CALL_CLASSIFICATIONS,
  zCallClassification,
} from "./call-taxonomy.js";

describe("call taxonomy", () => {
  it("has exactly 12 classes (SYSTEM_DESIGN §4.2)", () => {
    expect(CALL_CLASSIFICATIONS).toHaveLength(12);
  });

  it("accepts every declared classification", () => {
    for (const c of CALL_CLASSIFICATIONS) {
      expect(zCallClassification.parse(c)).toBe(c);
    }
  });

  it("rejects an unknown classification", () => {
    expect(() => zCallClassification.parse("robocall_spam")).toThrow();
  });

  it("has a human-readable label for every class", () => {
    for (const c of CALL_CLASSIFICATIONS) {
      expect(CALL_CLASSIFICATION_LABELS[c]).toBeTypeOf("string");
      expect(CALL_CLASSIFICATION_LABELS[c].length).toBeGreaterThan(0);
    }
  });
});
