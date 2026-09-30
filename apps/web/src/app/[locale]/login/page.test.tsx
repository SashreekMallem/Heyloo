import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
let search = "";
let signInResult: () => Promise<unknown>;
let claimsAppMetadata: Record<string, unknown> = {};
const signInWithPassword = vi.fn((_values: unknown) => signInResult());

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: {
    auth: {
      signInWithPassword: (values: unknown) => signInWithPassword(values),
      getClaims: async () => ({
        data: { claims: { aal: "aal1", app_metadata: claimsAppMetadata } },
        error: null,
      }),
    },
  },
}));

const { default: LoginPage } = await import("./page");

const OK = async () => ({ data: { user: { id: "u1" } }, error: null });

async function submit() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), "member@example.com");
  await user.type(screen.getByLabelText("Password"), "correct-horse");
  await user.click(screen.getByRole("button", { name: "Log in" }));
}

beforeEach(() => {
  push.mockReset();
  signInWithPassword.mockClear();
  search = "";
  signInResult = OK;
  claimsAppMetadata = { tenant_id: "t1", role: "owner" };
});

describe("/login — post-login redirect (AUTH-01, AUTH-08)", () => {
  it.each([
    ["absolute URL", "https://example.org/phish"],
    ["protocol-relative", "//example.org/phish"],
    ["backslash host", "/\\example.org/phish"],
    ["javascript: URL", "javascript:alert(1)"],
    ["percent-encoded slashes", "%2F%2Fexample.org"],
  ])("ignores a %s next and goes to the role home", async (_name, next) => {
    search = `next=${encodeURIComponent(next)}`;
    render(<LoginPage />);
    await submit();
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(push).toHaveBeenCalledWith("/dashboard");
  });

  it("honours a same-origin path, query included", async () => {
    search = `next=${encodeURIComponent("/dashboard/billing?x=1")}`;
    render(<LoginPage />);
    await submit();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/billing?x=1"));
  });

  it.each([
    [{ platform_admin: true }, "/cockpit"],
    [{ referral_partner_id: "p1" }, "/portal"],
    [{}, "/no-access"],
  ])("falls back to the role home for %j", async (claims, home) => {
    claimsAppMetadata = claims;
    render(<LoginPage />);
    await submit();
    await waitFor(() => expect(push).toHaveBeenCalledWith(home));
  });
});

describe("/login — failure messages and submit state (AUTH-06, MAP-09)", () => {
  it("shows a rate-limit message, announced as an alert", async () => {
    signInResult = async () => ({
      data: { user: null },
      error: { status: 429, code: "over_request_rate_limit", name: "AuthApiError" },
    });
    render(<LoginPage />);
    await submit();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Too many attempts");
    expect(push).not.toHaveBeenCalled();
  });

  it("shows a connection message for a network failure", async () => {
    signInResult = async () => ({
      data: { user: null },
      error: { status: 0, name: "AuthRetryableFetchError" },
    });
    render(<LoginPage />);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection problem");
  });

  it("shows a connection message when the request throws", async () => {
    signInResult = async () => {
      throw new TypeError("Failed to fetch");
    };
    render(<LoginPage />);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection problem");
  });

  it("asks an unconfirmed user to confirm their email", async () => {
    signInResult = async () => ({
      data: { user: null },
      error: { status: 400, code: "email_not_confirmed", name: "AuthApiError" },
    });
    render(<LoginPage />);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Confirm your email first");
  });

  it("keeps 'Incorrect email or password.' for bad credentials", async () => {
    signInResult = async () => ({
      data: { user: null },
      error: { status: 400, code: "invalid_credentials", name: "AuthApiError" },
    });
    render(<LoginPage />);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password.");
  });

  it("disables the button and sends one request even when clicked three times", async () => {
    let release: (v: unknown) => void = () => {};
    signInResult = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    render(<LoginPage />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "member@example.com");
    await user.type(screen.getByLabelText("Password"), "correct-horse");
    const button = screen.getByRole("button", { name: "Log in" });
    await user.click(button);
    await user.click(button);
    await user.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    expect(signInWithPassword).toHaveBeenCalledTimes(1);
    release({ data: { user: null }, error: { status: 400, code: "invalid_credentials" } });
    await waitFor(() => expect(button).toBeEnabled());
  });
});

describe("/login — notices (AUTH-04, AUTH-10)", () => {
  it("explains a failed or expired email link", () => {
    search = "toast=confirm_failed";
    render(<LoginPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("invalid or has expired");
    expect(screen.getByRole("link", { name: "Forgot your password?" })).toHaveAttribute(
      "href",
      "/reset-password",
    );
  });

  it("links to sign-up for new visitors (MAP-09)", () => {
    render(<LoginPage />);
    expect(screen.getByRole("link", { name: "New here? Start free" })).toHaveAttribute(
      "href",
      "/signup",
    );
  });

  it("confirms a finished password reset", () => {
    search = "reset=success";
    render(<LoginPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Password updated");
  });

  it("shows no notice on a plain visit", () => {
    render(<LoginPage />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
