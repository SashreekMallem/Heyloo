import { describe, expect, it } from "vitest";
import { normalizeTranscript, speakerLabel } from "./transcript";

// The shape voice-events stores today: the provider's transcript_object, verbatim.
const PROVIDER_ROWS = [
  {
    role: "agent",
    content: "Hi, thanks for calling Acme. This call may be recorded and I'm an AI assistant.",
    words: [
      { word: "Hi,", start: 0.5, end: 0.8 },
      { word: "thanks", start: 0.8, end: 1.1 },
    ],
  },
  {
    role: "user",
    content: "I'd like to book a cleaning.",
    words: [{ word: "I'd", start: 6.25, end: 6.4 }],
  },
  { role: "agent", content: "Sure, what day works?", words: [] },
];

describe("normalizeTranscript (QA-1 F-3 / MAP-02)", () => {
  it("maps provider {role, content, words} rows to speaker/text/ts (no blank rows, no NaN)", () => {
    const turns = normalizeTranscript(PROVIDER_ROWS);
    expect(turns).toEqual([
      {
        speaker: "AI assistant",
        text: "Hi, thanks for calling Acme. This call may be recorded and I'm an AI assistant.",
        ts: 0.5,
      },
      { speaker: "Caller", text: "I'd like to book a cleaning.", ts: 6.25 },
      { speaker: "AI assistant", text: "Sure, what day works?", ts: 0 },
    ]);
    for (const t of turns) expect(Number.isFinite(t.ts)).toBe(true);
  });

  it("keeps canonical {speaker, text, ts} rows working and labels them", () => {
    expect(
      normalizeTranscript([
        { speaker: "agent", text: "Hello", ts: 1 },
        { speaker: "caller", text: "Hi", ts: 3.5 },
      ]),
    ).toEqual([
      { speaker: "AI assistant", text: "Hello", ts: 1 },
      { speaker: "Caller", text: "Hi", ts: 3.5 },
    ]);
  });

  it("is tolerant of null, non-arrays and malformed entries", () => {
    expect(normalizeTranscript(null)).toEqual([]);
    expect(normalizeTranscript("nope")).toEqual([]);
    expect(normalizeTranscript({ role: "agent", content: "x" })).toEqual([]);
    expect(
      normalizeTranscript([null, 5, "x", {}, { role: "agent" }, { role: "user", content: "  " }]),
    ).toEqual([]);
  });

  it("falls back to ts 0 for missing / negative / non-numeric timestamps", () => {
    expect(
      normalizeTranscript([
        { role: "user", content: "a", words: [{ start: "x" }] },
        { speaker: "agent", text: "b", ts: -3 },
        { speaker: "agent", text: "c", ts: "12" },
      ]).map((t) => t.ts),
    ).toEqual([0, 0, 12]);
  });

  it("labels unknown speakers instead of hiding them", () => {
    expect(speakerLabel("transfer_target")).toBe("Transfer_target");
    expect(speakerLabel(undefined)).toBe("Unknown");
    expect(speakerLabel("USER")).toBe("Caller");
  });
});
