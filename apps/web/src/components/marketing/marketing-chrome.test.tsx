import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    prefetch: _prefetch,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    prefetch?: boolean;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@heyloo/ui", () => ({ ThemeToggle: () => <button type="button">Theme</button> }));

const { MarketingHeader } = await import("./marketing-header");
const { MarketingFooter } = await import("./marketing-footer");
const { VERTICAL_CONTENT } = await import("@/content/marketing/verticals");

function withIntl(node: ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {node}
    </NextIntlClientProvider>
  );
}

describe("MarketingHeader", () => {
  it("links the four chapters, the demo, sign-up and log in", () => {
    render(withIntl(<MarketingHeader />));
    const primary = screen.getByRole("navigation", { name: "Primary" });
    expect(within(primary).getByRole("link", { name: "How a call goes" })).toHaveAttribute(
      "href",
      "/#call",
    );
    expect(within(primary).getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/#dashboard",
    );
    expect(within(primary).getByRole("link", { name: "Businesses" })).toHaveAttribute(
      "href",
      "/#trades",
    );
    expect(within(primary).getByRole("link", { name: "Pricing" })).toHaveAttribute(
      "href",
      "/pricing",
    );
    expect(within(primary).getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    expect(screen.getAllByRole("link", { name: "Hear a live demo" })[0]).toHaveAttribute(
      "href",
      "/#talk",
    );
    expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/signup");
  });

  it("opens and closes the phone menu, which carries everything the desktop nav has", async () => {
    const user = userEvent.setup();
    render(withIntl(<MarketingHeader />));
    expect(screen.queryByRole("navigation", { name: "Mobile" })).toBeNull();
    const toggle = screen.getByRole("button", { name: "Open menu" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    const menu = screen.getByRole("navigation", { name: "Mobile" });
    for (const name of ["How a call goes", "Dashboard", "Businesses", "Pricing", "Log in"]) {
      expect(within(menu).getByRole("link", { name })).toBeInTheDocument();
    }
    expect(within(menu).getByRole("link", { name: "Hear a live demo" })).toHaveAttribute(
      "href",
      "/#talk",
    );
    expect(within(menu).getByRole("button", { name: "Theme" })).toBeInTheDocument();
    await user.click(within(menu).getByRole("link", { name: "Pricing" }));
    expect(screen.queryByRole("navigation", { name: "Mobile" })).toBeNull();
  });
});

describe("MarketingHeader — session awareness and keyboard (F-13, MAP-16)", () => {
  afterEach(() => {
    document.cookie = "sb-testref-auth-token=; max-age=0; path=/";
  });

  it("swaps Log in / Get started for Open dashboard when a session cookie is present", async () => {
    document.cookie = "sb-testref-auth-token=base64-abc; path=/";
    render(withIntl(<MarketingHeader />));
    expect(await screen.findByRole("link", { name: "Open dashboard" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(screen.queryByRole("link", { name: "Log in" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Get started" })).toBeNull();
  });

  it("shows Log in and Get started to a visitor with no session", () => {
    render(withIntl(<MarketingHeader />));
    expect(screen.getByRole("link", { name: "Log in" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Get started" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open dashboard" })).toBeNull();
  });

  it("closes the phone menu on Escape and returns focus to the menu button", async () => {
    const user = userEvent.setup();
    render(withIntl(<MarketingHeader />));
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.getByRole("navigation", { name: "Mobile" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("navigation", { name: "Mobile" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open menu" })).toHaveFocus();
  });
});

describe("MarketingFooter", () => {
  it("keeps every link the old footer had: business types, product, legal", () => {
    render(withIntl(<MarketingFooter />));
    for (const vertical of VERTICAL_CONTENT.filter((v) => v.slug !== "generic")) {
      expect(screen.getByRole("link", { name: vertical.displayName })).toHaveAttribute(
        "href",
        `/${vertical.slug}`,
      );
    }
    for (const [name, href] of [
      ["Pricing", "/pricing"],
      ["Blog", "/blog"],
      ["Terms", "/legal/terms"],
      ["Privacy", "/legal/privacy"],
      ["Data Processing Addendum", "/legal/dpa"],
      ["Build a demo for your business", "/demo"],
    ] as const) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });

  it("states the AI + recording disclosure and carries the wordmark", () => {
    const { container } = render(withIntl(<MarketingFooter />));
    expect(
      screen.getByText(/tells the caller it’s an AI and that the call may be recorded/),
    ).toBeInTheDocument();
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- the wordmark is aria-hidden decoration, so no role/text query can reach it
    expect(container.querySelector("#ft-mark")).toHaveAttribute("aria-hidden", "true");
  });
});
