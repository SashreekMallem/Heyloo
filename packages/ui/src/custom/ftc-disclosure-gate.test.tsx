import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FTCDisclosureGate } from "./ftc-disclosure-gate.js";

beforeEach(() => {
  // Radix Checkbox measures itself with ResizeObserver, which jsdom lacks.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

describe("FTCDisclosureGate", () => {
  it("keeps the acknowledge button disabled until the box is checked", () => {
    render(<FTCDisclosureGate policyVersion="2026-09" onAcknowledge={vi.fn()} />);
    expect(screen.getByRole("button", { name: /acknowledge and continue/i })).toBeDisabled();
  });

  it("PT-03: re-enables the button when onAcknowledge rejects so the partner can retry", async () => {
    const onAcknowledge = vi
      .fn<(v: string) => Promise<void>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(undefined);

    const user = userEvent.setup();
    render(<FTCDisclosureGate policyVersion="2026-09" onAcknowledge={onAcknowledge} />);
    await user.click(screen.getByRole("checkbox"));
    const button = screen.getByRole("button", { name: /acknowledge and continue/i });
    await user.click(button);

    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    expect(onAcknowledge).toHaveBeenCalledTimes(2);
    expect(onAcknowledge).toHaveBeenCalledWith("2026-09");
  });
});
