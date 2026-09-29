import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./app-shell.js";

describe("AppShell (MAP-08)", () => {
  it("renders a Skip to content link, before the sidebar, that targets the main landmark", () => {
    render(
      <AppShell sidebar={<nav aria-label="Sidebar">side</nav>} topBar={<header>top</header>}>
        <p>page body</p>
      </AppShell>,
    );
    const skip = screen.getByRole("link", { name: "Skip to content" });
    expect(skip).toHaveAttribute("href", "#main-content");

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveTextContent("page body");

    const sidebar = screen.getByRole("navigation", { name: "Sidebar" });
    // The skip link comes first in DOM (= tab) order.
    expect(skip.compareDocumentPosition(sidebar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
