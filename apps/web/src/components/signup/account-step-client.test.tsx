import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signUp = vi.fn();
const resend = vi.fn();

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: {
    auth: { signUp: (a: unknown) => signUp(a), resend: (a: unknown) => resend(a) },
  },
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const { AccountStepClient } = await import("./account-step-client");

const draft = { business_type: "auto" as const, business_name: "Joe's Garage" };

async function fillAndSubmit() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Your name"), "Joe Owner");
  await user.type(screen.getByLabelText("Email"), "joe@joesgarage.com");
  await user.type(screen.getByLabelText("Password"), "correct horse battery staple 1");
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: /create account/i }));
}

function gotrueError(code: string, message: string, status = 422) {
  return { data: { user: null, session: null }, error: { code, message, status } };
}

describe("AccountStepClient — signup errors and email confirmation (SIGNUP-BILL-FIX A)", () => {
  beforeEach(() => {
    signUp.mockReset();
    resend.mockReset();
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
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["email_address_invalid", "Email address is invalid", /business email/i],
    ["weak_password", "Password should contain letters", /stronger password/i],
    ["over_email_send_rate_limit", "email rate limit exceeded", /too many confirmation emails/i],
    ["signup_disabled", "Signups not allowed", /temporarily closed/i],
  ])(
    "shows a clear message for GoTrue's %s instead of 'Something went wrong'",
    async (code, message, expected) => {
      signUp.mockResolvedValue(gotrueError(code, message, code.startsWith("over") ? 429 : 422));
      render(<AccountStepClient annual={false} whiteGlove={false} draft={draft} />);
      await fillAndSubmit();
      expect(await screen.findByText(expected)).toBeInTheDocument();
      expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
    },
  );

  it("offers a login link for user_already_exists", async () => {
    signUp.mockResolvedValue(gotrueError("user_already_exists", "User already registered"));
    render(<AccountStepClient annual={false} whiteGlove={false} draft={draft} />);
    await fillAndSubmit();
    expect(await screen.findByText(/already registered/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /log in instead/i })).toHaveAttribute(
      "href",
      "/login?next=/signup/resume",
    );
  });

  it("treats GoTrue's anti-enumeration success (empty identities) as already registered, not 'check your email'", async () => {
    signUp.mockResolvedValue({ data: { user: { identities: [] }, session: null }, error: null });
    render(<AccountStepClient annual={false} whiteGlove={false} draft={draft} />);
    await fillAndSubmit();
    expect(await screen.findByRole("link", { name: /log in instead/i })).toBeInTheDocument();
    expect(screen.queryByText(/check your email/i)).not.toBeInTheDocument();
  });

  it("sends emailRedirectTo (-> /auth/confirm, next=/signup/resume) and saves the wizard state on the user", async () => {
    signUp.mockResolvedValue({
      data: { user: { identities: [{ provider: "email" }] }, session: null },
      error: null,
    });
    render(<AccountStepClient annual={true} whiteGlove={true} draft={draft} />);
    await fillAndSubmit();
    await screen.findByText(/check your email/i);

    const args = signUp.mock.calls[0]?.[0] as {
      options: { emailRedirectTo: string; data: Record<string, unknown> };
    };
    expect(args.options.emailRedirectTo).toBe(
      `${window.location.origin}/auth/confirm?next=%2Fsignup%2Fresume`,
    );
    expect(args.options.data).toMatchObject({
      owner_name: "Joe Owner",
      signup_draft: { business_type: "auto", business_name: "Joe's Garage" },
      signup_plan: { annual: true, white_glove: true },
    });
  });

  it("with email confirmation on, shows a check-your-email panel (no dead-end 'then log in') and can resend", async () => {
    signUp.mockResolvedValue({
      data: { user: { identities: [{ provider: "email" }] }, session: null },
      error: null,
    });
    resend.mockResolvedValue({ error: null });
    render(<AccountStepClient annual={false} whiteGlove={false} draft={draft} />);
    await fillAndSubmit();
    expect(await screen.findByText(/joe@joesgarage.com/)).toBeInTheDocument();
    expect(screen.getByText(/take you straight to payment/i)).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: /resend/i }));
    await waitFor(() => expect(resend).toHaveBeenCalled());
    expect(resend.mock.calls[0]?.[0]).toMatchObject({
      type: "signup",
      email: "joe@joesgarage.com",
    });
    expect(await screen.findByText(/sent another confirmation email/i)).toBeInTheDocument();
  });

  it("maps a resend rate limit too", async () => {
    signUp.mockResolvedValue({
      data: { user: { identities: [{ provider: "email" }] }, session: null },
      error: null,
    });
    resend.mockResolvedValue({
      error: { code: "over_email_send_rate_limit", message: "rate", status: 429 },
    });
    render(<AccountStepClient annual={false} whiteGlove={false} draft={draft} />);
    await fillAndSubmit();
    await userEvent.setup().click(await screen.findByRole("button", { name: /resend/i }));
    expect(await screen.findByText(/too many confirmation emails/i)).toBeInTheDocument();
  });

  it("a returning signed-in customer (cancelled Stripe) skips account creation and goes straight to checkout", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ error: "checkout_failed" }, { status: 502 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AccountStepClient
        annual={false}
        whiteGlove={false}
        draft={draft}
        signedInEmail="joe@joesgarage.com"
      />,
    );
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /continue to payment/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(signUp).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't start the payment step/i);
  });
});
