import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (msg: string) => toastError(msg) } }));

const clearImpersonation = vi.fn();
vi.mock("@/lib/impersonation/state", () => ({ clearImpersonation: () => clearImpersonation() }));

const signOut = vi.fn();
const claims = vi.hoisted(() => ({ app_metadata: {} as Record<string, unknown> }));
vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: {
    auth: {
      getSession: async () => ({ data: { session: { user: { email: "sam@acme.test" } } } }),
      getClaims: async () => ({
        data: { claims: { app_metadata: claims.app_metadata } },
        error: null,
      }),
      signOut: () => signOut(),
    },
  },
}));

import { SidebarAccount, UserMenu } from "./user-menu";

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  toastError.mockReset();
  clearImpersonation.mockReset();
  signOut.mockReset();
  signOut.mockResolvedValue({ error: null });
  claims.app_metadata = { role: "owner", tenant_id: "t1" };
});

describe("UserMenu (QA-1 AUTH-02 / MAP-04)", () => {
  it("shows the signed-in email and role, with a Log out item", async () => {
    const user = userEvent.setup();
    render(<UserMenu />);
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    expect(await screen.findByText("sam@acme.test")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Log out" })).toBeInTheDocument();
  });

  it("labels a platform admin from the JWT claim", async () => {
    claims.app_metadata = { platform_admin: true };
    const user = userEvent.setup();
    render(<UserMenu />);
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    expect(await screen.findByText("Platform admin")).toBeInTheDocument();
  });

  it("Log out signs out, clears any impersonation flag and goes to /login", async () => {
    const user = userEvent.setup();
    render(<UserMenu />);
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(await screen.findByRole("menuitem", { name: "Log out" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(clearImpersonation).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it("stays put and says so when sign-out fails", async () => {
    signOut.mockResolvedValue({ error: new Error("network") });
    const user = userEvent.setup();
    render(<UserMenu />);
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(await screen.findByRole("menuitem", { name: "Log out" }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Couldn't log out — please try again."),
    );
    expect(push).not.toHaveBeenCalled();
    expect(clearImpersonation).not.toHaveBeenCalled();
  });
});

describe("SidebarAccount (mobile drawer footer)", () => {
  it("renders the email, role and a Log out button that signs out", async () => {
    const user = userEvent.setup();
    render(<SidebarAccount roleLabel="Referral partner" />);
    expect(await screen.findByText("sam@acme.test")).toBeInTheDocument();
    expect(screen.getByText("Referral partner")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
  });
});
