import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const replace = vi.fn();
let search = "";
let verifyResult: { error: unknown } = { error: null };

const listFactors = vi.fn(async () => ({ data: { totp: [{ id: "f1" }] }, error: null }));
const challenge = vi.fn(async (_a: unknown) => ({ data: { id: "c1" }, error: null }));
const verify = vi.fn(async (_a: unknown) => verifyResult);

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push, replace }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: {
    auth: {
      getUser: async () => ({ data: { user: { id: "u1" } } }),
      mfa: { listFactors, challenge, verify },
    },
  },
}));

const { default: MfaChallengePage } = await import("./page");

// jsdom has no layout engine; input-otp probes `elementFromPoint` on a timer.
document.elementFromPoint = () => null;

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  verify.mockClear();
  search = "";
  verifyResult = { error: null };
});

describe("/mfa/challenge", () => {
  it("AUTH-11/MAP-10: the OTP field is labelled and a one-time-code input", () => {
    render(<MfaChallengePage />);
    const input = screen.getByLabelText("6-digit verification code");
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
    expect(input).toHaveAttribute("inputmode", "numeric");
  });

  it("AUTH-11: accepts digits only — letters never enable Verify", async () => {
    render(<MfaChallengePage />);
    const user = userEvent.setup();
    const input = screen.getByLabelText("6-digit verification code");
    await user.type(input, "abcdef");
    expect(input).toHaveValue("");
    expect(screen.getByRole("button", { name: "Verify" })).toBeDisabled();
    await user.type(input, "123456");
    expect(input).toHaveValue("123456");
    expect(screen.getByRole("button", { name: "Verify" })).toBeEnabled();
  });

  it("returns to the same-origin next path after a correct code (COCKPIT-F19)", async () => {
    search = `next=${encodeURIComponent("/cockpit/tenants?status=active")}`;
    render(<MfaChallengePage />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("6-digit verification code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/cockpit/tenants?status=active"));
    expect(verify).toHaveBeenCalledWith(
      expect.objectContaining({ factorId: "f1", code: "123456" }),
    );
  });

  it.each(["https://example.org/phish", "//example.org/phish", "/\\example.org"])(
    "AUTH-01: falls back to /cockpit for the unsafe next %s",
    async (next) => {
      search = `next=${encodeURIComponent(next)}`;
      render(<MfaChallengePage />);
      const user = userEvent.setup();
      await user.type(screen.getByLabelText("6-digit verification code"), "123456");
      await user.click(screen.getByRole("button", { name: "Verify" }));
      await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
      expect(push).toHaveBeenCalledWith("/cockpit");
    },
  );

  it("AUTH-11: a wrong code shows an alert and clears the field", async () => {
    verifyResult = { error: { message: "invalid" } };
    render(<MfaChallengePage />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("6-digit verification code"), "111111");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect code");
    expect(screen.getByLabelText("6-digit verification code")).toHaveValue("");
    expect(push).not.toHaveBeenCalled();
  });
});
