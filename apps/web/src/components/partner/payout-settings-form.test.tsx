import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (m: string) => toastError(m), success: (m: string) => toastSuccess(m) },
}));

let updateResult: { data: { id: string }[] | null; error: { message: string } | null } = {
  data: [{ id: "partner-1" }],
  error: null,
};
const update = vi.fn();
const eq = vi.fn();
const select = vi.fn();
vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: {
    from: () => ({
      update: (values: unknown) => {
        update(values);
        return {
          eq: (col: string, value: string) => {
            eq(col, value);
            return {
              select: (cols: string) => {
                select(cols);
                return Promise.resolve(updateResult);
              },
            };
          },
        };
      },
    }),
  },
}));

const { PayoutSettingsForm } = await import("./payout-settings-form");

describe("PayoutSettingsForm (PT-02, PT-08)", () => {
  beforeEach(() => {
    update.mockReset();
    eq.mockReset();
    select.mockReset();
    toastError.mockReset();
    toastSuccess.mockReset();
    updateResult = { data: [{ id: "partner-1" }], error: null };
  });

  it("pre-fills the saved PayPal email", () => {
    render(<PayoutSettingsForm partnerId="partner-1" initialEmail="saved@example.com" />);
    expect(screen.getByLabelText("PayPal email")).toHaveValue("saved@example.com");
  });

  it("saves against the partner's own row and confirms", async () => {
    const user = userEvent.setup();
    render(<PayoutSettingsForm partnerId="partner-1" initialEmail="" />);
    await user.type(screen.getByLabelText("PayPal email"), "new@example.com");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Saved"));
    expect(update).toHaveBeenCalledWith({ paypal_email: "new@example.com", payout_method: "paypal" });
    expect(eq).toHaveBeenCalledWith("id", "partner-1");
    expect(select).toHaveBeenCalledWith("id");
  });

  it("does not toast Saved when the write matched zero rows", async () => {
    updateResult = { data: [], error: null };
    const user = userEvent.setup();
    render(<PayoutSettingsForm partnerId="partner-1" initialEmail="a@example.com" />);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("toasts an error on a database error", async () => {
    updateResult = { data: null, error: { message: "boom" } };
    const user = userEvent.setup();
    render(<PayoutSettingsForm partnerId="partner-1" initialEmail="a@example.com" />);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("shows an inline error and never writes for a 300-char local part", async () => {
    const user = userEvent.setup();
    render(<PayoutSettingsForm partnerId="partner-1" initialEmail="" />);
    await user.click(screen.getByLabelText("PayPal email"));
    await user.paste(`${"a".repeat(300)}@example.com`);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Enter a valid PayPal email address")).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });
});
