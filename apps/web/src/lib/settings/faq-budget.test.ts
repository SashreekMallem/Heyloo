import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  countFaqItemsAgentReads,
  FAQ_LIVE_ANSWER_MAX_CHARS,
  FAQ_LIVE_MAX_CHARS,
  FAQ_LIVE_MAX_ITEMS,
  FAQ_LIVE_QUESTION_MAX_CHARS,
} from "./faq-budget";

describe("countFaqItemsAgentReads", () => {
  it("counts every entry when the FAQ is small", () => {
    expect(
      countFaqItemsAgentReads([
        { question: "a", answer: "b" },
        { question: "c", answer: "d" },
      ]),
    ).toBe(2);
    expect(countFaqItemsAgentReads([])).toBe(0);
  });

  it("skips half-filled entries", () => {
    expect(
      countFaqItemsAgentReads([
        { question: "a", answer: "" },
        { question: "", answer: "b" },
        { question: "c", answer: "d" },
      ]),
    ).toBe(1);
  });

  it("stops at the entry cap and at the character budget (earlier entries win)", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ question: `q${i}`, answer: `a${i}` }));
    expect(countFaqItemsAgentReads(many)).toBe(FAQ_LIVE_MAX_ITEMS);
    const long = Array.from({ length: 25 }, () => ({ question: "q", answer: "x".repeat(600) }));
    const used = countFaqItemsAgentReads(long);
    expect(used).toBeGreaterThan(0);
    expect(used).toBeLessThan(25);
  });
});

describe("drift guard: the portal's budget equals the call-time reader's", () => {
  it("mirrors the constants in supabase/functions/_shared/agent-settings.ts", () => {
    // Vitest runs with the app (apps/web) as cwd.
    const source = readFileSync(
      resolve(process.cwd(), "../../supabase/functions/_shared/agent-settings.ts"),
      "utf8",
    );
    const read = (name: string) =>
      Number(new RegExp(`export const ${name} = (\\d+);`).exec(source)?.[1]);
    expect(read("FAQ_MAX_ITEMS")).toBe(FAQ_LIVE_MAX_ITEMS);
    expect(read("FAQ_MAX_CHARS")).toBe(FAQ_LIVE_MAX_CHARS);
    expect(read("FAQ_QUESTION_MAX_CHARS")).toBe(FAQ_LIVE_QUESTION_MAX_CHARS);
    expect(read("FAQ_ANSWER_MAX_CHARS")).toBe(FAQ_LIVE_ANSWER_MAX_CHARS);
  });
});
