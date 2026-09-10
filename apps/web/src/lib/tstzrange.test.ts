import { describe, expect, it } from "vitest";
import { parseTstzrange } from "./tstzrange";

describe("parseTstzrange", () => {
  it("parses a Postgres tstzrange's default text format into ISO bounds", () => {
    const result = parseTstzrange('["2026-09-08 09:00:00+00","2026-09-08 09:30:00+00")');
    expect(result).toEqual({
      start: "2026-09-08T09:00:00+00:00",
      end: "2026-09-08T09:30:00+00:00",
    });
  });

  it("returns null for an unrecognized string", () => {
    expect(parseTstzrange("not-a-range")).toBeNull();
  });
});
