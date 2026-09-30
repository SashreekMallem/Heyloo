import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let search = "";
let resetResult: { error: unknown } = { error: null };
const resetPasswordForEmail = vi.fn(async (_email: string, _opts: unknown) => resetResult);

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: { auth: { resetPasswordForEmail } },
}));

const { default: ResetPasswordRequestPage } = await import("./page");

beforeEach(() => {
  search = "";
  resetResult = { error: null };
  resetPasswordForEmail.mockClear();
});

async function requestLink() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), "owner@example.com");
  await user.click(screen.getByRole("button", { name: "Send reset link" }));
  return user;
}

describe("/reset-password (AUTH-10, AUTH-04)", () => {
  it("offers Back to log in on the form", () => {
    render(<ResetPasswordRequestPage />);
    expect(screen.getByRole("link", { name: "Back to log in" })).toHaveAttribute("href", "/login");
  });

  it("after sending, shows the confirmation with Back to log in and a working Resend", async () => {
    render(<ResetPasswordRequestPage />);
    const user = await requestLink();
    expect(await screen.findByText(/we've sent a reset link/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to log in" })).toHaveAttribute("href", "/login");

    await user.click(screen.getByRole("button", { name: "Resend the link" }));
    await waitFor(() => expect(resetPasswordForEmail).toHaveBeenCalledTimes(2));
    expect(resetPasswordForEmail.mock.calls[1]?.[0]).toBe("owner@example.com");
    expect(await screen.findByText(/We just sent it again/)).toBeVisible();
  });

  it("does not reveal whether the address is registered (other errors look like a send)", async () => {
    resetResult = { error: { status: 400, code: "user_not_found" } };
    render(<ResetPasswordRequestPage />);
    await requestLink();
    expect(await screen.findByText(/we've sent a reset link/)).toBeVisible();
  });

  it("tells a rate-limited visitor to wait instead of claiming a send", async () => {
    resetResult = { error: { status: 429, code: "over_email_send_rate_limit" } };
    render(<ResetPasswordRequestPage />);
    await requestLink();
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests");
    expect(screen.queryByText(/we've sent a reset link/)).toBeNull();
  });

  it("explains an expired recovery link up front", () => {
    search = "error=expired";
    render(<ResetPasswordRequestPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("invalid or has expired");
  });
});
