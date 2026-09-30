import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ThemeToggle } from "../layout/theme-toggle.js";
import { Button } from "./button.js";
import { Checkbox } from "./checkbox.js";
import { Input } from "./input.js";
import { Select, SelectTrigger, SelectValue } from "./select.js";
import { Switch } from "./switch.js";
import { Textarea } from "./textarea.js";

describe("phone touch targets (QA-1 MAP-05)", () => {
  it("icon buttons are 44px below lg and 36px from lg up", () => {
    render(<Button size="icon" aria-label="Menu" />);
    const cls = screen.getByRole("button", { name: "Menu" }).className;
    expect(cls).toContain("size-11");
    expect(cls).toContain("lg:size-9");
  });

  it("the theme toggle matches the icon button", () => {
    render(<ThemeToggle />);
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("size-11");
    expect(cls).toContain("lg:size-9");
  });

  it("inputs and select triggers are h-11 below lg", () => {
    render(
      <>
        <Input aria-label="name" />
        <Select>
          <SelectTrigger aria-label="kind">
            <SelectValue />
          </SelectTrigger>
        </Select>
      </>,
    );
    expect(screen.getByLabelText("name").className).toContain("h-11");
    expect(screen.getByLabelText("name").className).toContain("lg:h-9");
    expect(screen.getByRole("combobox", { name: "kind" }).className).toContain("h-11");
  });

  it("checkbox and switch extend their hit area to 44px with a pseudo-element", () => {
    render(
      <>
        <Checkbox aria-label="agree" />
        <Switch aria-label="enabled" />
      </>,
    );
    expect(screen.getByRole("checkbox", { name: "agree" }).className).toContain("after:-inset-3.5");
    expect(screen.getByRole("switch", { name: "enabled" }).className).toContain("after:-inset-y-3");
  });
});

describe("iOS zoom-on-focus (QA-1 MAP-06)", () => {
  it("text fields are 16px on phones and 14px from md up", () => {
    render(
      <>
        <Input aria-label="a" />
        <Textarea aria-label="b" />
        <Select>
          <SelectTrigger aria-label="c">
            <SelectValue />
          </SelectTrigger>
        </Select>
      </>,
    );
    for (const el of [
      screen.getByLabelText("a"),
      screen.getByLabelText("b"),
      screen.getByRole("combobox", { name: "c" }),
    ]) {
      expect(el.className).toContain("text-base");
      expect(el.className).toContain("md:text-sm");
      expect(el.className).not.toMatch(/(^|\s)text-sm(\s|$)/);
    }
  });
});
