import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const search = vi.hoisted(() => ({ value: "toast=no_access" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(search.value) }));

const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push }) }));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

const performSignOut = vi.fn();
vi.mock("@/lib/auth/sign-out", () => ({ performSignOut: () => performSignOut() }));

import { RoleGuardToast } from "./role-guard-toast";

beforeEach(() => {
  toastError.mockReset();
  push.mockReset();
  performSignOut.mockReset();
  search.value = "toast=no_access";
});

describe("RoleGuardToast (QA-1 AUTH-02)", () => {
  it("shows the no-access toast with a Log out action", () => {
    render(<RoleGuardToast />);
    expect(toastError).toHaveBeenCalledTimes(1);
    const [message, options] = toastError.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe("You don't have access to that page");
    expect(options.action.label).toBe("Log out");
  });

  it("the action signs out then goes to /login", async () => {
    performSignOut.mockResolvedValue(true);
    render(<RoleGuardToast />);
    const [, options] = toastError.mock.calls[0] as [string, { action: { onClick: () => void } }];
    options.action.onClick();
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
  });

  it("the action reports a failed sign-out instead of navigating", async () => {
    performSignOut.mockResolvedValue(false);
    render(<RoleGuardToast />);
    const [, options] = toastError.mock.calls[0] as [string, { action: { onClick: () => void } }];
    options.action.onClick();
    await vi.waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Couldn't log out — please try again."),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("shows nothing without the no_access param", () => {
    search.value = "";
    render(<RoleGuardToast />);
    expect(toastError).not.toHaveBeenCalled();
  });
});
