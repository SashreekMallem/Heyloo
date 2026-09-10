import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TenantIdProvider } from "@/lib/tenant/tenant-context";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import ReferPage from "./page";

function renderPage() {
  const client = new QueryClient();
  return render(
    <TenantIdProvider tenantId="t1">
      <QueryClientProvider client={client}>
        <ReferPage />
      </QueryClientProvider>
    </TenantIdProvider>,
  );
}

describe("ReferPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a loading state — never the real link/funnel — before the fetch resolves", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})), // never resolves during this assertion
    );
    renderPage();
    expect(screen.queryByText("Your referral link")).not.toBeInTheDocument();
  });

  it("renders the real referral link and non-blank funnel tiles once loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          code: "abc123",
          funnel: { signups: 2, qualified: 1, paid: 0 },
          approaching_w9_threshold: false,
        }),
      ),
    );
    renderPage();
    expect(await screen.findByText(/\/signup\?ref=abc123/)).toBeInTheDocument();
    // Every funnel tile shows a real number, never blank space.
    expect(screen.getByText("Clicks")).toBeInTheDocument();
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows a real placeholder (never a blank input) when no link could be generated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          code: null,
          funnel: { signups: 0, qualified: 0, paid: 0 },
          approaching_w9_threshold: false,
        }),
      ),
    );
    renderPage();
    expect(await screen.findByText(/couldn't generate your link/i)).toBeInTheDocument();
  });
});
