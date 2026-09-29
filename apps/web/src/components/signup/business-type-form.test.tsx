import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push }) }));

const { BusinessTypeForm } = await import("./business-type-form");

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
});

describe("BusinessTypeForm (F-12)", () => {
  it("shows an error instead of looking dead when saving the draft fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "boom" }, { status: 500 })),
    );
    render(<BusinessTypeForm initialBusinessName="Joe's Garage" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't save your details/i);
    expect(push).not.toHaveBeenCalled();
  });

  it("shows the same error when the network call throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    render(<BusinessTypeForm initialBusinessName="Joe's Garage" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("navigates to the plan step when the draft is saved", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true })),
    );
    render(<BusinessTypeForm initialBusinessName="Joe's Garage" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/signup/plan"));
  });

  it("prefills the business name and vertical from the saved draft", () => {
    render(<BusinessTypeForm initialVertical="dental" initialBusinessName="Bright Smiles" />);
    expect(screen.getByLabelText("Business name")).toHaveValue("Bright Smiles");
    expect(screen.getByRole("button", { name: /dental/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /veterinary/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
