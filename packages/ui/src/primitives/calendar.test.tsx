import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DateRangePicker } from "../forms/date-range-picker.js";
import { Calendar } from "./calendar.js";

const GLOBALS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../theme/globals.css"),
  "utf8",
);

describe("Calendar styling (QA-1 MAP-03)", () => {
  it("imports react-day-picker's stylesheet, which v10 does not apply on its own", () => {
    expect(GLOBALS).toMatch(/@import\s+"react-day-picker\/style\.css";/);
    // ...and the specifier resolves from this package.
    const resolved = createRequire(import.meta.url).resolve("react-day-picker/style.css");
    expect(readFileSync(resolved, "utf8")).toContain(".rdp-root");
  });

  it("re-points the calendar's accent at the Heyloo primary token after the import", () => {
    const importAt = GLOBALS.indexOf("react-day-picker/style.css");
    const overrideAt = GLOBALS.indexOf("--rdp-accent-color: var(--primary)");
    expect(overrideAt).toBeGreaterThan(importAt);
  });

  it("renders the library's root class so the stylesheet actually binds", () => {
    const { container } = render(<Calendar mode="single" />);
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- asserting the library's own class hook
    expect(container.querySelector(".rdp-root")).not.toBeNull();
  });
});

describe("DateRangePicker popover (QA-1 MAP-11)", () => {
  it("opens a dialog with an accessible name", async () => {
    const user = userEvent.setup();
    render(<DateRangePicker value={undefined} onChange={() => {}} />);
    await user.click(screen.getByRole("button", { name: /Pick a date range/ }));
    expect(screen.getByRole("dialog", { name: "Choose a date range" })).toBeInTheDocument();
  });
});
