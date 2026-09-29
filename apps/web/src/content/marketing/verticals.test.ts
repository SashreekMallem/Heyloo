import { describe, expect, it } from "vitest";
import { STATS_DISCLAIMER, VERTICAL_CONTENT } from "./verticals";

describe("vertical copy claims (F-17)", () => {
  const copy = VERTICAL_CONTENT.flatMap((v) => [v.heroStat, ...v.painStats]).join("\n");

  it.each([
    "38%",
    "$135k",
    "$100k–$182k",
    "$3,200",
    "$75k–$180k",
    "917",
    "48%",
    "$7,500",
    "$8.2k",
    "418,000",
    "we've measured",
  ])("does not print the unsourced figure %s", (figure) => {
    expect(copy).not.toContain(figure);
  });

  it("carries a disclaimer that the statistics are illustrative", () => {
    expect(STATS_DISCLAIMER).toMatch(/estimates/i);
    expect(STATS_DISCLAIMER).toMatch(/not .*guarantee/i);
  });
});
