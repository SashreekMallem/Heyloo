import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const replace = vi.fn();

type Factor = {
  id: string;
  factor_type: string;
  status: "verified" | "unverified";
  friendly_name: string;
};
// A tiny model of GoTrue's factor store, including its name-conflict rule.
let factors: Factor[] = [];
let claimsAppMetadata: Record<string, unknown> = { admin_mfa_required: true };
let user: { id: string } | null = { id: "u1" };
let failNextEnroll = false;
let seq = 0;

const listFactors = vi.fn(async () => ({
  data: { all: [...factors], totp: factors.filter((f) => f.status === "verified") },
  error: null,
}));
const unenroll = vi.fn(async ({ factorId }: { factorId: string }) => {
  factors = factors.filter((f) => f.id !== factorId);
  return { data: {}, error: null };
});
const enroll = vi.fn(async ({ friendlyName }: { friendlyName?: string }) => {
  if (failNextEnroll) {
    failNextEnroll = false;
    return { data: null, error: { code: "unexpected_failure" } };
  }
  if (factors.some((f) => f.friendly_name === (friendlyName ?? ""))) {
    return { data: null, error: { code: "mfa_factor_name_conflict" } };
  }
  seq += 1;
  const id = `factor-${seq}`;
  factors.push({
    id,
    factor_type: "totp",
    status: "unverified",
    friendly_name: friendlyName ?? "",
  });
  return {
    data: { id, totp: { qr_code: `data:image/svg+xml;utf8,qr-${seq}`, secret: `SECRET${seq}` } },
    error: null,
  };
});
const challenge = vi.fn(async (_a: unknown) => ({ data: { id: "c1" }, error: null }));
const verify = vi.fn(async (_a: unknown) => ({ error: null }));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push, replace }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: {
    auth: {
      getUser: async () => ({ data: { user } }),
      getClaims: async () => ({
        data: { claims: { aal: "aal1", app_metadata: claimsAppMetadata } },
        error: null,
      }),
      mfa: { listFactors, unenroll, enroll, challenge, verify },
    },
  },
}));

const { default: MfaEnrollPage } = await import("./page");

// jsdom has no layout engine; input-otp probes `elementFromPoint` on a timer.
document.elementFromPoint = () => null;

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  enroll.mockClear();
  unenroll.mockClear();
  verify.mockClear();
  factors = [];
  seq = 0;
  failNextEnroll = false;
  user = { id: "u1" };
  claimsAppMetadata = { admin_mfa_required: true };
});

describe("/mfa/enroll (AUTH-03)", () => {
  it("shows the QR code and the manual key", async () => {
    render(<MfaEnrollPage />);
    expect(await screen.findByAltText("TOTP QR code")).toBeVisible();
    expect(screen.getByText("SECRET1")).toBeVisible();
  });

  it("re-enrols on every revisit instead of dead-ending on mfa_factor_name_conflict", async () => {
    const view = render(<MfaEnrollPage />);
    await screen.findByAltText("TOTP QR code");
    view.unmount();

    // Second visit: the first visit's unverified factor is still on the user.
    expect(factors).toHaveLength(1);
    render(<MfaEnrollPage />);
    await waitFor(() => expect(screen.getByText("SECRET2")).toBeVisible());
    expect(screen.getByAltText("TOTP QR code")).toBeVisible();
    // The stale factor was removed, so exactly one unverified factor remains.
    expect(unenroll).toHaveBeenCalledWith({ factorId: "factor-1" });
    expect(factors).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders an inline error with a working retry when enrolment fails", async () => {
    failNextEnroll = true;
    render(<MfaEnrollPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't start two-factor setup");
    const user_ = userEvent.setup();
    await user_.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByAltText("TOTP QR code")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not enrol a non-admin: sends them to /no-access", async () => {
    claimsAppMetadata = { tenant_id: "t1", role: "owner" };
    render(<MfaEnrollPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/no-access"));
    expect(enroll).not.toHaveBeenCalled();
  });

  it("does not enrol an admin who already holds a verified factor: sends them to the challenge", async () => {
    factors = [{ id: "v1", factor_type: "totp", status: "verified", friendly_name: "phone" }];
    render(<MfaEnrollPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/mfa/challenge?next=%2Fcockpit"));
    expect(enroll).not.toHaveBeenCalled();
    expect(unenroll).not.toHaveBeenCalled();
  });

  it("sends an already-elevated admin straight to the cockpit", async () => {
    claimsAppMetadata = { platform_admin: true };
    render(<MfaEnrollPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/cockpit"));
    expect(enroll).not.toHaveBeenCalled();
  });

  it("sends an anonymous visitor to log in", async () => {
    user = null;
    render(<MfaEnrollPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?next=%2Fmfa%2Fenroll"));
  });

  it("AUTH-11: digits only, then verifies and continues to the cockpit", async () => {
    render(<MfaEnrollPage />);
    await screen.findByAltText("TOTP QR code");
    const user_ = userEvent.setup();
    const input = screen.getByLabelText("6-digit verification code");
    await user_.type(input, "abcdef");
    expect(input).toHaveValue("");
    await user_.type(input, "654321");
    await user_.click(screen.getByRole("button", { name: "Verify and continue" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/cockpit"));
    expect(verify).toHaveBeenCalledWith(
      expect.objectContaining({ factorId: "factor-1", code: "654321" }),
    );
  });
});
