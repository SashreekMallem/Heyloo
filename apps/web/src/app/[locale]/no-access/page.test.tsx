import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

class RedirectSignal extends Error {
  constructor(public destination: string) {
    super(`NEXT_REDIRECT:${destination}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (destination: string) => {
    throw new RedirectSignal(destination);
  },
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

let mockUser: unknown = null;
let mockAppMetadata: unknown = {};
const signOut = vi.fn(async () => ({ error: null }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: mockUser } }),
      getClaims: async () => ({
        data: { claims: { aal: "aal1", app_metadata: mockAppMetadata } },
        error: null,
      }),
    },
  }),
}));

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: { auth: { signOut } },
}));

const { default: NoAccessPage } = await import("./page");

describe("/no-access (AUTH-05)", () => {
  it("sends an anonymous visitor to /login", async () => {
    mockUser = null;
    await expect(NoAccessPage()).rejects.toMatchObject({ destination: "/login" });
  });

  it("explains a signed-in user with no workspace, offers to finish setup and to log out", async () => {
    mockUser = { id: "u1", email: "nomember@example.com" };
    mockAppMetadata = {};
    render(await NoAccessPage());

    expect(screen.getByRole("heading", { name: "Finish setting up your business" })).toBeVisible();
    expect(screen.getByText("nomember@example.com")).toBeVisible();
    expect(screen.getByRole("link", { name: "Finish setting up your business" })).toHaveAttribute(
      "href",
      "/signup/resume",
    );
    expect(screen.getByRole("link", { name: "Contact support" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Log out" })).toBeVisible();
  });

  it("points a wrong-role user at their own home instead", async () => {
    mockUser = { id: "u1", email: "owner@example.com" };
    mockAppMetadata = { tenant_id: "t1", role: "owner" };
    render(await NoAccessPage());

    expect(screen.getByRole("link", { name: "Go to your dashboard" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(screen.queryByRole("link", { name: "Finish setting up your business" })).toBeNull();
  });

  it("logs out through Supabase and returns to /login", async () => {
    mockUser = { id: "u1", email: "nomember@example.com" };
    mockAppMetadata = {};
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    render(await NoAccessPage());

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/login"));
    vi.unstubAllGlobals();
  });
});
