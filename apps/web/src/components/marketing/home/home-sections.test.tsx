/* eslint-disable testing-library/no-node-access -- these tests pin the static markup contract the motion runtime binds to (poster paths, grid cells, data hooks, section order); none of it has a role or text query */
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

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

const { Call } = await import("./call");
const { Dashboard } = await import("./dashboard");
const { Finale } = await import("./finale");
const { Hero } = await import("./hero");
const { Hours } = await import("./hours");
const { Setup } = await import("./setup");
const { Trades } = await import("./trades");
const { CALL_LINES, TRADES } = await import("@/content/marketing/home");

describe("server-rendered home sections", () => {
  it("hero: text-first h1, both CTAs, the demo button lands on #talk", () => {
    render(<Hero />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Every call, answered.");
    expect(screen.getByRole("link", { name: /Hear a live demo/ })).toHaveAttribute("href", "#talk");
    expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/signup");
    expect(screen.getByText("From $299 a month. Live the same day.")).toBeInTheDocument();
    // the no-WebGL poster ships in the markup
    expect(document.querySelectorAll(".poster-svg path")).toHaveLength(36);
  });

  it("hours: the whole 168 hour week is in the markup, 50 open and 118 closed", () => {
    render(<Hours />);
    expect(document.querySelectorAll(".wk-row .c")).toHaveLength(168);
    expect(document.querySelectorAll(".wk-row .c.o")).toHaveLength(50);
    expect(document.querySelectorAll(".wk-row .c.x")).toHaveLength(118);
    expect(screen.getAllByText(/Heyloo answers all 168/).length).toBeGreaterThan(0);
  });

  it("call: the full transcript reads with no JS, in order, with the disclosure first", () => {
    render(<Call />);
    const items = within(document.getElementById("call-script") as HTMLElement).getAllByRole(
      "listitem",
    );
    expect(items).toHaveLength(CALL_LINES.length);
    expect(items[0]).toHaveTextContent("this call may be recorded");
    expect(items[0]).toHaveAttribute("data-spk", "ava");
    expect(items[1]).toHaveAttribute("data-spk", "caller");
    expect(document.querySelectorAll(".beat")).toHaveLength(5);
    expect(screen.getByRole("link", { name: "Skip the call" })).toHaveAttribute(
      "href",
      "#dashboard",
    );
  });

  it("dashboard: four focus words and the four blocks the runtime highlights", () => {
    render(<Dashboard />);
    expect(document.querySelectorAll(".word")).toHaveLength(4);
    for (const block of ["transcript", "recording", "summary", "booking"]) {
      expect(document.querySelector(`[data-block="${block}"]`)).not.toBeNull();
    }
    expect(document.getElementById("dash-slot")).not.toBeNull();
  });

  it("trades: eight articles and eight tabs; the Spanish example is marked lang=es", () => {
    render(<Trades />);
    expect(document.querySelectorAll("article.trade")).toHaveLength(TRADES.length);
    expect(document.querySelectorAll(".tabs a")).toHaveLength(TRADES.length);
    expect(document.querySelector('[lang="es"] .ex')).not.toBeNull();
  });

  it("setup: three steps, all visible without JS", () => {
    render(<Setup />);
    expect(document.querySelectorAll(".step.on")).toHaveLength(3);
  });

  it("finale: trust, then the live demo, then pricing, then start", () => {
    render(<Finale demoPhone="+15125550100" />);
    const order = [...document.querySelectorAll("#finale > section")].map((s) => s.id);
    expect(order).toEqual(["trust", "talk", "pricing", "start"]);
  });

  it("finale: the AI and recording disclosure is printed above the call button, in both languages", () => {
    render(<Finale />);
    const trust = document.getElementById("trust") as HTMLElement;
    expect(within(trust).getByText("AI assistant")).toBeInTheDocument();
    expect(within(trust).getByText("asistente de inteligencia artificial")).toBeInTheDocument();
    const talk = document.getElementById("talk") as HTMLElement;
    const button = within(talk).getByRole("button", { name: /Talk to Heyloo/ });
    const disclosure = within(talk).getByText(/talking to an AI assistant/);
    expect(disclosure.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_PRECEDING).toBe(0);
    expect(disclosure).toHaveTextContent("recorded");
  });

  it("finale: shows the demo phone when one is configured, and not otherwise", () => {
    const { unmount } = render(<Finale demoPhone="+15125550100" />);
    expect(screen.getByRole("link", { name: "(512) 555-0100" })).toHaveAttribute(
      "href",
      "tel:+15125550100",
    );
    unmount();
    render(<Finale />);
    expect(screen.queryByRole("link", { name: /555/ })).toBeNull();
  });
});
