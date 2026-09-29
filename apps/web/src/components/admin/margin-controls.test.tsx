import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MarginControlsProvider, useMarginControls } from "./margin-controls";

function Page({ name, withTestToggle }: { name: string; withTestToggle?: boolean }) {
  const { period, includeTest, qs, controls } = useMarginControls({
    withPeriod: true,
    ...(withTestToggle === undefined ? {} : { withTestToggle }),
  });
  return (
    <section aria-label={name}>
      {controls}
      <output data-testid="state">{`${period}|${includeTest}|${qs}`}</output>
    </section>
  );
}

/** Stands in for the margin layout + the router swapping the child page. */
function Layout() {
  const [page, setPage] = useState<"waterfall" | "customers" | "drilldown">("waterfall");
  return (
    <MarginControlsProvider>
      <nav>
        {(["waterfall", "customers", "drilldown"] as const).map((p) => (
          <button key={p} type="button" onClick={() => setPage(p)}>
            go {p}
          </button>
        ))}
      </nav>
      <Page key={page} name={page} />
    </MarginControlsProvider>
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/cockpit/margin/waterfall");
});
afterEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

// COCKPIT-F20
describe("margin controls persistence", () => {
  it("keeps 'Include test data' and the period when navigating between margin pages", async () => {
    render(<Layout />);
    const toggle = () => screen.getByRole("switch", { name: "Include test data" });
    expect(toggle()).toHaveAttribute("aria-checked", "false");

    await userEvent.click(toggle());
    await userEvent.click(screen.getByRole("button", { name: "Quarter" }));
    expect(toggle()).toHaveAttribute("aria-checked", "true");

    await userEvent.click(screen.getByRole("button", { name: "go customers" }));
    expect(screen.getByRole("region", { name: "customers" })).toBeInTheDocument();
    expect(toggle()).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("state")).toHaveTextContent(
      "quarter|true|?period=quarter&include_test=1",
    );

    // F13: the drill-down (a third page) sees the same choice the list had
    await userEvent.click(screen.getByRole("button", { name: "go drilldown" }));
    expect(toggle()).toHaveAttribute("aria-checked", "true");
  });

  it("writes the choice to the URL and sessionStorage so a reload keeps it", async () => {
    render(<Layout />);
    await userEvent.click(screen.getByRole("switch", { name: "Include test data" }));
    expect(window.location.search).toContain("include_test=1");
    expect(window.sessionStorage.getItem("heyloo.cockpit.margin-controls")).toContain(
      '"includeTest":true',
    );
    await userEvent.click(screen.getByRole("switch", { name: "Include test data" }));
    expect(window.location.search).not.toContain("include_test");
  });

  it("restores the choice from the URL on load", async () => {
    window.history.replaceState(
      null,
      "",
      "/cockpit/margin/customers?period=last_month&include_test=1",
    );
    render(<Layout />);
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Include test data" })).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
    expect(screen.getByTestId("state")).toHaveTextContent(
      "last_month|true|?period=last_month&include_test=1",
    );
  });

  it("falls back to sessionStorage when the URL carries nothing", async () => {
    window.sessionStorage.setItem(
      "heyloo.cockpit.margin-controls",
      JSON.stringify({ period: "quarter", includeTest: true }),
    );
    render(<Layout />);
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Include test data" })).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
    expect(screen.getByTestId("state")).toHaveTextContent("quarter|true|");
  });

  it("defaults to this month / real data only, and ignores corrupt storage", () => {
    window.sessionStorage.setItem("heyloo.cockpit.margin-controls", "{not json");
    render(<Layout />);
    expect(screen.getByRole("switch", { name: "Include test data" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByTestId("state")).toHaveTextContent("mtd|false|?period=mtd");
  });
});
