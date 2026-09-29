import { describe, expect, it } from "vitest";
import { CALL_LINES } from "@/content/marketing/home";
import {
  buildCallScript,
  clock,
  energyAt,
  wallClock,
  waveformPath,
  wordTimes,
} from "./voice-model";

describe("wordTimes", () => {
  it("spreads words across the window, in order, without overlapping", () => {
    const words = wordTimes("Thanks for calling Riverside Auto Repair.", 0, 6);
    expect(words).toHaveLength(6);
    expect(words[0]?.t).toBe(0);
    for (let i = 1; i < words.length; i++) {
      const prev = words[i - 1];
      const cur = words[i];
      expect(cur && prev && cur.t >= prev.t + prev.d).toBe(true);
    }
    const last = words[words.length - 1];
    expect(last && last.t + last.d).toBeLessThanOrEqual(6);
  });

  it("counts letters and digits only, and gives a word before punctuation more time", () => {
    const [plain, comma] = wordTimes("Hi Hi, ok", 0, 9);
    expect(wordTimes("It’s", 0, 1)[0]?.n).toBe(3);
    expect(comma && plain && comma.d).toBeGreaterThan(plain?.d ?? 0);
  });
});

describe("buildCallScript", () => {
  const script = buildCallScript();

  it("has one utterance per line and every word tied to its utterance", () => {
    expect(script.utterances).toHaveLength(CALL_LINES.length);
    expect(script.words.every((w) => w.u >= 0 && w.u < CALL_LINES.length)).toBe(true);
    expect(script.words.filter((w) => w.spk === 0).length).toBeGreaterThan(20);
    expect(script.words.filter((w) => w.spk === 1).length).toBeGreaterThan(10);
  });

  it("is built once", () => {
    expect(buildCallScript()).toBe(script);
  });

  it("is silent before the call and while nobody talks, loud mid-word", () => {
    expect(energyAt(-1, script.words)).toBe(0);
    expect(energyAt(10.6, script.words)).toBe(0); // the gap between Ava and the caller
    const first = script.words[3];
    expect(first && energyAt(first.t + first.d / 2, script.words)).toBeGreaterThan(0.3);
  });
});

describe("formatting and the waveform", () => {
  it("formats the call clock and the wall clock", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(58.9)).toBe("0:58");
    expect(clock(75)).toBe("1:15");
    expect(wallClock(7.4)).toBe("11:52:07 PM");
  });

  it("draws 96 vertical bars on the 192 x 32 box", () => {
    const d = waveformPath();
    expect(d.match(/M/g)).toHaveLength(96);
    expect(d.startsWith("M1 ")).toBe(true);
    expect(d.endsWith("V")).toBe(false);
  });
});
