import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ManualModeBanner } from "./manual-mode-banner.js";

describe("ManualModeBanner (QA-1 F-10)", () => {
  it("describes the same behaviour as the Manual Mode card: no booking, the AI takes a message", () => {
    render(<ManualModeBanner since="2026-09-29T12:00:00Z" />);
    expect(screen.getByText(/not booking, rescheduling or cancelling/)).toBeInTheDocument();
    expect(
      screen.getByText(/takes a message so your team can confirm each request/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/SMS/)).not.toBeInTheDocument();
  });

  it("only offers 'Turn off' when a handler is given", () => {
    const { rerender } = render(<ManualModeBanner since="2026-09-29T12:00:00Z" />);
    expect(screen.queryByRole("button", { name: "Turn off" })).not.toBeInTheDocument();
    rerender(<ManualModeBanner since="2026-09-29T12:00:00Z" onDisable={() => {}} />);
    expect(screen.getByRole("button", { name: "Turn off" })).toBeInTheDocument();
  });
});
