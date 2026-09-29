import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CallFeedItem } from "./call-feed-item.js";

describe("CallFeedItem", () => {
  it("formats the caller number for display instead of showing raw E.164", () => {
    render(
      <CallFeedItem
        call={{
          id: "call-1",
          callerNumber: "+15125551000",
          classification: null,
          startedAt: null,
          durationSeconds: null,
        }}
      />,
    );
    expect(screen.getByText("(512) 555-1000")).toBeInTheDocument();
    expect(screen.queryByText("+15125551000")).not.toBeInTheDocument();
  });

  it("falls back to 'Unknown number' when the caller number is missing", () => {
    render(
      <CallFeedItem
        call={{
          id: "call-1",
          callerNumber: null,
          classification: null,
          startedAt: null,
          durationSeconds: null,
        }}
      />,
    );
    expect(screen.getByText("Unknown number")).toBeInTheDocument();
  });
});

describe("CallFeedItem duration (QA-1 F-16)", () => {
  it("shows seconds for a short call and m/s for a longer one instead of rounding to whole minutes", () => {
    const base = {
      id: "c",
      callerNumber: "+15125551000",
      classification: null,
      startedAt: null,
    };
    const { rerender } = render(<CallFeedItem call={{ ...base, durationSeconds: 20 }} />);
    expect(screen.getByText(/· 20s/)).toBeInTheDocument();
    rerender(<CallFeedItem call={{ ...base, durationSeconds: 62 }} />);
    expect(screen.getByText(/· 1m 2s/)).toBeInTheDocument();
  });
});
