import { describe, expect, it } from "vitest";
import { buildCustomerSearchFilters, escapeLike } from "./search";

describe("buildCustomerSearchFilters (QA-1 F-10 / SEC-15)", () => {
  it("returns no filters for an empty / whitespace term", () => {
    expect(buildCustomerSearchFilters("")).toEqual({ namePattern: null, phonePattern: null });
    expect(buildCustomerSearchFilters("   ")).toEqual({ namePattern: null, phonePattern: null });
  });

  it("matches a phone typed the way it is displayed against the stored E.164 digits", () => {
    expect(buildCustomerSearchFilters("(555) 201-9010")).toEqual({
      namePattern: "%(555) 201-9010%",
      phonePattern: "%5552019010%",
    });
  });

  it("keeps commas and parentheses inert (they are plain characters in a standalone ilike value)", () => {
    expect(buildCustomerSearchFilters("Malone, Drew").namePattern).toBe("%Malone, Drew%");
    expect(buildCustomerSearchFilters("Malone, Drew").phonePattern).toBeNull();
    // The injection payload is just text to match now, never filter grammar.
    expect(buildCustomerSearchFilters("x%,name.neq.zzz").namePattern).toBe("%x\\%,name.neq.zzz%");
  });

  it("escapes LIKE wildcards so '%' and '_' no longer match everything", () => {
    expect(buildCustomerSearchFilters("%").namePattern).toBe("%\\%%");
    expect(buildCustomerSearchFilters("a_b").namePattern).toBe("%a\\_b%");
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
  });

  it("uses digits only for the phone pattern", () => {
    expect(buildCustomerSearchFilters("9010").phonePattern).toBe("%9010%");
    expect(buildCustomerSearchFilters("+1 555").phonePattern).toBe("%1555%");
  });
});
