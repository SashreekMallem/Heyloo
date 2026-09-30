import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const pathname = vi.hoisted(() => ({ current: "/portal" }));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => pathname.current,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: {
    auth: {
      getSession: async () => ({ data: { session: { user: { email: "pat@partner.test" } } } }),
      getClaims: async () => ({ data: { claims: { app_metadata: {} } }, error: null }),
      signOut: async () => ({ error: null }),
    },
  },
}));

import { PartnerShellClient } from "./partner-shell-client";

afterEach(() => {
  pathname.current = "/portal";
});

describe("PartnerShellClient (QA-1)", () => {
  it("does not keep Dashboard highlighted on a nested portal page (F-01)", () => {
    pathname.current = "/portal/payouts";
    render(
      <PartnerShellClient partnerName="Pat">
        <p>body</p>
      </PartnerShellClient>,
    );
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(
      within(nav)
        .getAllByRole("link", { current: "page" })
        .map((a) => a.textContent),
    ).toEqual(["Payouts"]);
  });

  it("offers an account menu with Log out (AUTH-02)", () => {
    render(
      <PartnerShellClient partnerName="Pat">
        <p>body</p>
      </PartnerShellClient>,
    );
    expect(screen.getByRole("button", { name: "Account menu" })).toBeInTheDocument();
  });
});
