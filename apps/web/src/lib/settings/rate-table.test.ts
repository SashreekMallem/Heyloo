import { describe, expect, it } from "vitest";
import { parseRateTable, rateTableToText } from "./rate-table";

describe("rate table", () => {
  it("parses dollars into integer cents", () => {
    expect(parseRateTable("Standard: $89\nKing Suite: 129.50\n\n")).toEqual({
      entries: [
        { room_type: "Standard", nightly_rate_cents: 8900 },
        { room_type: "King Suite", nightly_rate_cents: 12950 },
      ],
      errors: [],
    });
  });

  it("reports bad and duplicate lines instead of dropping them silently", () => {
    const result = parseRateTable("Standard: 89\nDeluxe 99\nstandard: 90\nSuite: abc");
    expect(result.entries).toEqual([{ room_type: "Standard", nightly_rate_cents: 8900 }]);
    expect(result.errors).toHaveLength(3);
    expect(result.errors[0]).toMatch(/^Line 2/);
  });

  it("round-trips stored cents to owner-readable text", () => {
    const text = rateTableToText([{ room_type: "Standard", nightly_rate_cents: 8900 }]);
    expect(text).toBe("Standard: $89.00");
    expect(parseRateTable(text).entries).toEqual([
      { room_type: "Standard", nightly_rate_cents: 8900 },
    ]);
  });
});
