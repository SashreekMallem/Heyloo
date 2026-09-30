import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell.js";
import { AppSidebarNav } from "./app-sidebar-nav.js";
import { MobileTabBar, MobileTabBarLabel, MobileTabBarMenuButton } from "./mobile-tab-bar.js";
import type { NavItem } from "./nav-types.js";
import { TopBar } from "./top-bar.js";

const SECTIONS = [
  {
    label: "Operate",
    items: [
      { label: "Overview", href: "/dashboard", exact: true },
      { label: "Calls", href: "/dashboard/calls" },
      { label: "Billing", href: "/dashboard/billing" },
    ],
  },
];

const TABS: NavItem[] = [
  { label: "Overview", href: "/dashboard", exact: true },
  { label: "Calls", href: "/dashboard/calls" },
  { label: "More", href: "#more", exact: true },
];

function Shell({ activeHref, onNavigate }: { activeHref: string; onNavigate?: () => void }) {
  return (
    <AppShell
      sidebar={
        <AppSidebarNav
          sections={SECTIONS}
          activeHref={activeHref}
          renderLink={(item) => (
            <a
              href={item.href}
              onClick={(e) => {
                e.preventDefault();
                onNavigate?.();
              }}
            >
              {item.label}
            </a>
          )}
        />
      }
      topBar={<TopBar>top</TopBar>}
      mobileTabBar={
        <MobileTabBar
          items={TABS}
          activeHref={activeHref}
          renderLink={(item, isActive) =>
            item.href === "#more" ? (
              <MobileTabBarMenuButton item={item} />
            ) : (
              <a href={item.href}>
                <MobileTabBarLabel item={item} isActive={isActive} />
              </a>
            )
          }
        />
      }
    >
      <p>content</p>
    </AppShell>
  );
}

function stubDesktop(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("sidebar navigation semantics", () => {
  it("is a labelled nav landmark and marks only the current page (F-01, MAP-12)", () => {
    render(<Shell activeHref="/dashboard/calls" />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    const current = within(nav).getAllByRole("link", { current: "page" });
    expect(current.map((a) => a.textContent)).toEqual(["Calls"]);
    // Overview is NOT highlighted next to Calls.
    expect(within(nav).getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
  });

  it("marks Overview only on the dashboard root", () => {
    render(<Shell activeHref="/dashboard" />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(
      within(nav)
        .getAllByRole("link", { current: "page" })
        .map((a) => a.textContent),
    ).toEqual(["Overview"]);
  });

  it("labels the bottom tab bar 'Primary' and marks one current tab", () => {
    render(<Shell activeHref="/dashboard/calls" />);
    const bar = screen.getByRole("navigation", { name: "Primary" });
    expect(
      within(bar)
        .getAllByRole("link", { current: "page" })
        .map((a) => a.textContent),
    ).toEqual(["Calls"]);
  });

  it("does not highlight any tab on a page that is not a tab (Messages)", () => {
    render(<Shell activeHref="/dashboard/messages" />);
    const bar = screen.getByRole("navigation", { name: "Primary" });
    expect(within(bar).queryAllByRole("link", { current: "page" })).toHaveLength(0);
  });
});

describe("phone navigation drawer", () => {
  it("opens from the top-bar toggle with an accessible name", async () => {
    stubDesktop(false);
    const user = userEvent.setup();
    render(<Shell activeHref="/dashboard" />);
    await user.click(screen.getByRole("button", { name: "Toggle sidebar" }));
    expect(screen.getByRole("dialog", { name: "Navigation" })).toBeInTheDocument();
  });

  it("closes after a nav link is chosen (MAP-01)", async () => {
    stubDesktop(false);
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<Shell activeHref="/dashboard" onNavigate={onNavigate} />);
    await user.click(screen.getByRole("button", { name: "Toggle sidebar" }));
    const dialog = screen.getByRole("dialog", { name: "Navigation" });
    await user.click(within(dialog).getByRole("link", { name: "Billing" }));
    expect(onNavigate).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("returns focus to the toggle after Escape (MAP-11)", async () => {
    stubDesktop(false);
    const user = userEvent.setup();
    render(<Shell activeHref="/dashboard" />);
    const toggle = screen.getByRole("button", { name: "Toggle sidebar" });
    await user.click(toggle);
    expect(screen.getByRole("dialog", { name: "Navigation" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });

  it("'More' opens the drawer instead of navigating (F-13) and focus returns to it", async () => {
    stubDesktop(false);
    const user = userEvent.setup();
    render(<Shell activeHref="/dashboard" />);
    const more = screen.getByRole("button", { name: "More" });
    await user.click(more);
    const dialog = screen.getByRole("dialog", { name: "Navigation" });
    expect(within(dialog).getByRole("link", { name: "Billing" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(more).toHaveFocus();
  });

  it("on desktop the toggle collapses the rail and never opens a second, modal copy (COCKPIT-F22)", async () => {
    stubDesktop(true);
    const user = userEvent.setup();
    render(<Shell activeHref="/dashboard" />);
    await user.click(screen.getByRole("button", { name: "Toggle sidebar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
