import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/server", () => ({ setRequestLocale: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/marketing/reveal", () => ({
  Reveal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const { default: PricingPage, metadata } = await import("./page");

async function renderPage() {
  render(await PricingPage({ params: Promise.resolve({ locale: "en" }) }));
}

describe("/pricing free-trial copy (TRIAL-1)", () => {
  it("leads with the free trial and states its terms plainly", async () => {
    await renderPage();
    expect(
      screen.getByRole("heading", { level: 1, name: "Start your 7-day free trial" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/free for 7 days or 100 call minutes, whichever comes first/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/a card is required to start/i)).toBeInTheDocument();
  });

  it("the signup CTA starts the trial", async () => {
    await renderPage();
    expect(screen.getByRole("link", { name: "Start your 7-day free trial" })).toHaveAttribute(
      "href",
      "/signup",
    );
  });

  it("has a free-trial FAQ entry", async () => {
    await renderPage();
    expect(
      screen.getByRole("button", { name: "How does the free trial work?" }),
    ).toBeInTheDocument();
  });

  it("mentions the trial in the page description", () => {
    expect(metadata.description).toContain("7-day free trial");
  });
});
