import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const toastError = vi.fn();

vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m) } }));

const { DisclosureGateClient } = await import("./disclosure-gate-client");

async function acknowledge() {
  const user = userEvent.setup();
  render(<DisclosureGateClient policyVersion="2026-09" />);
  await user.click(screen.getByRole("checkbox"));
  const button = screen.getByRole("button", { name: /acknowledge and continue/i });
  await user.click(button);
  return button;
}

describe("DisclosureGateClient (PT-03)", () => {
  beforeEach(() => {
    push.mockReset();
    toastError.mockReset();
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("navigates to the portal on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    await acknowledge();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/portal"));
    expect(toastError).not.toHaveBeenCalled();
  });

  it("shows an error toast on a server error and keeps the button usable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    const button = await acknowledge();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not save, please try again"));
    expect(push).not.toHaveBeenCalled();
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("shows an error toast and re-enables the button when the request itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const button = await acknowledge();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not save, please try again"));
    await waitFor(() => expect(button).toBeEnabled());
  });
});
