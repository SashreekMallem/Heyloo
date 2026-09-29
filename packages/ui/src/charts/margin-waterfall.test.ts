import { describe, expect, it } from "vitest";
import { buildWaterfallBuckets } from "./margin-waterfall.js";

describe("buildWaterfallBuckets", () => {
  it("stacks a normal positive waterfall above zero", () => {
    const b = buildWaterfallBuckets([
      { label: "Revenue", amount: 1000, kind: "add" },
      { label: "Cost", amount: 300, kind: "subtract" },
      { label: "Net", amount: 700, kind: "total" },
    ]);
    expect(b[0]).toMatchObject({ base: 0, pos: 1000, neg: 0, runningTotal: 1000 });
    // the cost bar hangs from 1000 down to 700
    expect(b[1]).toMatchObject({ base: 700, pos: 300, neg: 0, delta: -300, runningTotal: 700 });
    expect(b[2]).toMatchObject({ base: 0, pos: 700, neg: 0, delta: 700 });
  });

  it("draws subtract bars BELOW zero once the running total is negative (no revenue)", () => {
    const b = buildWaterfallBuckets([
      { label: "Revenue", amount: 0, kind: "add" },
      { label: "Voice", amount: 150, kind: "subtract" },
      { label: "LLM", amount: 50, kind: "subtract" },
      { label: "Net margin", amount: -200, kind: "total" },
    ]);
    // Voice spans 0 -> -150: invisible base at the top edge (0), visible part below zero.
    expect(b[1]).toMatchObject({ base: 0, pos: 0, neg: -150, runningTotal: -150 });
    // LLM spans -150 -> -200: invisible base of -150, visible extra -50 stacked beneath it.
    expect(b[2]).toMatchObject({ base: -150, pos: 0, neg: -50, runningTotal: -200 });
    // Total is the negative net margin drawn from zero downward.
    expect(b[3]).toMatchObject({ base: 0, pos: 0, neg: -200, delta: -200 });
  });

  it("splits a bar that crosses zero into an above and a below part", () => {
    const b = buildWaterfallBuckets([
      { label: "Revenue", amount: 100, kind: "add" },
      { label: "Big cost", amount: 250, kind: "subtract" },
    ]);
    // 100 -> -150: 100 above zero and 150 below, one continuous bar.
    expect(b[1]).toMatchObject({ base: 0, pos: 100, neg: -150, runningTotal: -150 });
  });
});
