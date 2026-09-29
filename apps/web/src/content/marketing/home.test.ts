import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CALL_BEATS, CALL_LINES, CALL_SECONDS, TRADES, TRUST } from "./home";

/** The compiler's opening line, from source: the page must say exactly what the agent says. */
const OPENING_SOURCE = readFileSync(
  path.resolve(
    import.meta.dirname,
    "../../../../../packages/adapters/retell/src/compiler/opening.ts",
  ),
  "utf8",
);

const EN_TEMPLATE =
  "Thanks for calling {{business_name}}. This is {{assistant_name}}, their AI assistant — this call may be recorded.";

function fill(template: string): string {
  return template
    .replace("{{business_name}}", "Riverside Auto Repair")
    .replace("{{assistant_name}}", "Ava");
}

function quote(copy: typeof TRUST.en | typeof TRUST.es): string {
  return `${copy.before}${copy.marks[0]}${copy.between}${copy.marks[1]}${copy.after}`;
}

describe("home page copy", () => {
  it("shows the English disclosure the compiler speaks, with the example business filled in", () => {
    expect(OPENING_SOURCE).toContain(`"${EN_TEMPLATE}"`);
    expect(quote(TRUST.en)).toBe(fill(EN_TEMPLATE));
  });

  it("shows the Spanish disclosure exactly as the compiler's translation table has it", () => {
    const match = OPENING_SOURCE.match(/es: "(Gracias por llamar a [^"]+)"/);
    expect(match).not.toBeNull();
    expect(quote(TRUST.es)).toBe(fill(match?.[1] ?? ""));
  });

  it("opens the example call with the same AI + recording disclosure", () => {
    expect(CALL_LINES[0]?.text.startsWith(fill(EN_TEMPLATE))).toBe(true);
  });

  it("tells one call that fits its clock: alternating speakers, in order, inside 58 seconds", () => {
    expect(CALL_SECONDS).toBe(58);
    let previousEnd = -1;
    CALL_LINES.forEach((line, i) => {
      expect(line.speaker).toBe(i % 2 === 0 ? "ava" : "caller");
      expect(line.t0).toBeGreaterThan(previousEnd);
      expect(line.t1).toBeGreaterThan(line.t0);
      previousEnd = line.t1;
    });
    expect(previousEnd).toBeLessThan(CALL_SECONDS);
  });

  it("has five beats and eight business types", () => {
    expect(CALL_BEATS).toHaveLength(5);
    expect(TRADES).toHaveLength(8);
    expect(new Set(TRADES.map((t) => t.id)).size).toBe(8);
  });
});
