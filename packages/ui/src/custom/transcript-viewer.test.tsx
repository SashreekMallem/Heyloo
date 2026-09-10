import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type TranscriptTurn, TranscriptViewer } from "./transcript-viewer.js";

describe("TranscriptViewer", () => {
  it("renders normally when every turn has a speaker", () => {
    const turns: TranscriptTurn[] = [
      { speaker: "agent", text: "Hello, how can I help?", ts: 0 },
      { speaker: "caller", text: "I'd like to book a table.", ts: 4 },
    ];
    render(<TranscriptViewer turns={turns} />);
    expect(screen.getByText("I'd like to book a table.")).toBeInTheDocument();
  });

  it("does not crash on a line missing speaker/role (undefined) and still renders the text", () => {
    // Real transcript rows don't always carry a `speaker` — a malformed or
    // differently-shaped row (e.g. `{ role, text }` instead of
    // `{ speaker, text }`) must never throw "toLowerCase of undefined".
    const turns = [
      { speaker: "agent", text: "Thanks for calling.", ts: 0 },
      { text: "Missing a speaker field entirely.", ts: 4 } as unknown as TranscriptTurn,
    ];
    expect(() => render(<TranscriptViewer turns={turns} />)).not.toThrow();
    expect(screen.getByText("Missing a speaker field entirely.")).toBeInTheDocument();
  });

  it("does not crash when speaker is null", () => {
    const turns = [{ speaker: null, text: "Null speaker.", ts: 0 } as unknown as TranscriptTurn];
    expect(() => render(<TranscriptViewer turns={turns} />)).not.toThrow();
    expect(screen.getByText("Null speaker.")).toBeInTheDocument();
  });
});
