import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SegmentBadge } from "./segment-badge.js";

describe("SegmentBadge", () => {
  it.each(["new", "returning", "loyal", "vip"] as const)(
    "renders the mapped label for %s",
    (segment) => {
      render(<SegmentBadge segment={segment} />);
      expect(screen.getByText(new RegExp(segment, "i"))).toBeInTheDocument();
    },
  );

  it("renders a neutral fallback badge instead of crashing for an unmapped segment value", () => {
    // Runtime data doesn't always honor the `CustomerSegment` type — a
    // legacy/null/unexpected value from the database must never throw.
    const unknownSegment = "legacy_tier" as unknown as Parameters<
      typeof SegmentBadge
    >[0]["segment"];
    expect(() => render(<SegmentBadge segment={unknownSegment} />)).not.toThrow();
    expect(screen.getByText("legacy_tier")).toBeInTheDocument();
  });

  it("falls back to 'Unknown' for a null/empty segment value", () => {
    const nullSegment = null as unknown as Parameters<typeof SegmentBadge>[0]["segment"];
    expect(() => render(<SegmentBadge segment={nullSegment} />)).not.toThrow();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });
});
