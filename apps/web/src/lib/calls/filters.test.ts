import { describe, expect, it } from "vitest";
import { csvCell, csvRow } from "./csv";
import {
  buildCallOrFilter,
  parseCallSearch,
  parseClassification,
  parseIsoInstant,
} from "./filters";

describe("csvCell (QA-1 F-17)", () => {
  it("neutralises formula-leading characters", () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvCell("+SUM(A1)")).toBe('"\'+SUM(A1)"');
    expect(csvCell("-2+3")).toBe('"\'-2+3"');
    expect(csvCell("@cmd")).toBe('"\'@cmd"');
    expect(csvCell("\tx")).toBe('"\'\tx"');
    expect(csvCell("\rx")).toBe('"\'\rx"');
  });
  it("leaves plain values and E.164 phone numbers intact", () => {
    expect(csvCell("+15551234567")).toBe('"+15551234567"');
    expect(csvCell("booked")).toBe('"booked"');
    expect(csvCell(120)).toBe('"120"');
    expect(csvCell(null)).toBe('""');
  });
  it("doubles embedded quotes and joins rows", () => {
    expect(csvRow(['say "hi"', 1])).toBe('"say ""hi""","1"');
  });
});

describe("call search / filter helpers (QA-1 F-15)", () => {
  it("classifications outside the CHECK enum are rejected", () => {
    expect(parseClassification("new_booking")).toBe("new_booking");
    expect(parseClassification("nope")).toBeNull();
    expect(parseClassification(null)).toBeNull();
  });

  it("splits a term into a phone-digits part and a name part", () => {
    expect(parseCallSearch("")).toEqual({ digits: null, namePattern: null });
    expect(parseCallSearch("(555) 201-9010")).toEqual({ digits: "5552019010", namePattern: null });
    expect(parseCallSearch("Jamie")).toEqual({ digits: null, namePattern: "%Jamie%" });
    expect(parseCallSearch("a%b")).toEqual({ digits: null, namePattern: "%a\\%b%" });
    // fewer than 3 digits is too short to be a useful number match
    expect(parseCallSearch("12").digits).toBeNull();
  });

  it("builds an .or() expression from digits and validated E.164 numbers only", () => {
    const term = { digits: "5552019010", namePattern: "%x%" };
    expect(buildCallOrFilter(term, ["+15552019010", "not-a-phone", "+1555,name.neq.x"])).toBe(
      "caller_number.ilike.%5552019010%,caller_number.in.(+15552019010)",
    );
    expect(buildCallOrFilter({ digits: null, namePattern: "%x%" }, [])).toBeNull();
  });

  it("parses ISO instants", () => {
    expect(parseIsoInstant("2026-09-29T04:00:00.000Z")).toBe("2026-09-29T04:00:00.000Z");
    expect(parseIsoInstant("garbage")).toBeNull();
    expect(parseIsoInstant(null)).toBeNull();
  });
});
