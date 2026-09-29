import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
let session: unknown = { access_token: "recovery" };
let updateResult: { error: unknown } = { error: null };
const updateUser = vi.fn(async (_a: unknown) => updateResult);
const signOut = vi.fn(async () => ({ error: null }));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push }),
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: {
    auth: {
      getSession: async () => ({ data: { session } }),
      updateUser,
      signOut,
    },
  },
}));

const { default: ResetPasswordConfirmPage } = await import("./page");

beforeEach(() => {
  push.mockReset();
  updateUser.mockClear();
  signOut.mockClear();
  session = { access_token: "recovery" };
  updateResult = { error: null };
});

describe("/reset-password/confirm (AUTH-10, MAP-20)", () => {
  it("MAP-20: empty submit shows one friendly message per field, never raw zod text", async () => {
    render(<ResetPasswordConfirmPage />);
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole("button", { name: "Set password" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Set password" }));
    expect(await screen.findByText("Password must be at least 8 characters")).toBeVisible();
    expect(screen.getByText("Confirm your new password")).toBeVisible();
    expect(document.body.textContent).not.toMatch(/Too small|expected string/);
  });

  it("a short password with a matching confirmation shows only the length message", async () => {
    render(<ResetPasswordConfirmPage />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("New password"), "short");
    await user.type(screen.getByLabelText("Confirm password"), "short");
    await user.click(screen.getByRole("button", { name: "Set password" }));
    expect(await screen.findByText("Password must be at least 8 characters")).toBeVisible();
    expect(document.body.textContent).not.toMatch(/Too small|expected string/);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("with no recovery session shows the expired-link card up front, not a usable form", async () => {
    session = null;
    render(<ResetPasswordConfirmPage />);
    expect(await screen.findByRole("heading", { name: "This link has expired" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Request a new link" })).toHaveAttribute(
      "href",
      "/reset-password",
    );
    expect(screen.queryByLabelText("New password")).toBeNull();
  });

  it("on success signs the recovery session out and returns to login with a notice flag", async () => {
    render(<ResetPasswordConfirmPage />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("New password"), "a-new-password");
    await user.type(screen.getByLabelText("Confirm password"), "a-new-password");
    await user.click(screen.getByRole("button", { name: "Set password" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login?reset=success"));
    expect(updateUser).toHaveBeenCalledWith({ password: "a-new-password" });
    expect(signOut).toHaveBeenCalled();
  });

  it("maps a same-password rejection to a specific message, announced as an alert", async () => {
    updateResult = { error: { code: "same_password" } };
    render(<ResetPasswordConfirmPage />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("New password"), "a-new-password");
    await user.type(screen.getByLabelText("Confirm password"), "a-new-password");
    await user.click(screen.getByRole("button", { name: "Set password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("haven't used before");
    expect(push).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });
});
