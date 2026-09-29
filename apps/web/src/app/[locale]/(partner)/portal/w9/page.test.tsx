import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

let w9Status = "not_submitted";
vi.mock("@/lib/auth/require-partner-session", () => ({
  requirePartnerSession: async () => ({ partner: { id: "p1", name: "Ada", w9_status: w9Status } }),
}));

const { default: W9Page } = await import("./page");

describe("W9Page (PT-04)", () => {
  it("offers a mailto to support, not a third-party homepage, when nothing is on file", async () => {
    w9Status = "not_submitted";
    render(await W9Page());
    const link = screen.getByRole("link", { name: /email support to submit your w-9/i });
    expect(link.getAttribute("href")).toMatch(/^mailto:support@heyloo\.com\?subject=/);
    expect(document.querySelector('a[href*="track1099"]')).toBeNull();
  });

  it("shows a review message and no CTA once submitted", async () => {
    w9Status = "submitted";
    render(await W9Page());
    expect(screen.getByText(/reviewing it/i)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows the on-file message when verified", async () => {
    w9Status = "verified";
    render(await W9Page());
    expect(screen.getByText(/on file and verified/i)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
