import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { Link } from "@/i18n/navigation";
import { AuthShell } from "./auth-shell";

describe("AuthShell footer (QA-1 MAP-05)", () => {
  it("gives footer links vertical padding so they clear a 44px tap target", () => {
    render(
      <AuthShell title="Log in" footer={<Link href="/reset-password">Forgot your password?</Link>}>
        <p>form</p>
      </AuthShell>,
    );
    const link = screen.getByRole("link", { name: "Forgot your password?" });
    // The footer wrapper carries the rule that pads every anchor inside it.
    expect(link.parentElement?.className).toContain("[&_a]:py-3.5");
    expect(link.parentElement?.className).toContain("[&_a]:inline-block");
  });

  it("renders without a footer", () => {
    render(
      <AuthShell title="Log in">
        <p>form</p>
      </AuthShell>,
    );
    expect(screen.getByRole("heading", { name: "Log in" })).toBeInTheDocument();
  });
});
