import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const { default: ConfigLabPage } = await import("./page");

afterEach(() => vi.unstubAllGlobals());

// COCKPIT-F23
describe("Config Lab validation", () => {
  it("shows a message on the volume field and does not call the API", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<ConfigLabPage />);
    const volume = screen.getByLabelText("Assumed monthly call volume");
    fireEvent.change(volume, { target: { value: "-5" } });
    await userEvent.click(screen.getByRole("button", { name: "Run simulation" }));
    expect(await screen.findByText("Call volume can't be negative")).toBeInTheDocument();
    expect(volume).toHaveAttribute("aria-invalid", "true");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an absurd volume with its own message", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<ConfigLabPage />);
    const volume = screen.getByLabelText("Assumed monthly call volume");
    await userEvent.clear(volume);
    await userEvent.type(volume, "99999999");
    await userEvent.click(screen.getByRole("button", { name: "Run simulation" }));
    expect(
      await screen.findByText("Call volume is capped at 1,000,000 a month"),
    ).toBeInTheDocument();
  });
});
