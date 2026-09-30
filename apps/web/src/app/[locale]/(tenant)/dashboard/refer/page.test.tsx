import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TenantIdProvider } from "@/lib/tenant/tenant-context";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

let attributionLive = true;
vi.mock("@/lib/referrals/attribution", () => ({
  isReferralAttributionLive: () => attributionLive,
}));

import ReferPage from "./page";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
    attributionLive = true;
  });

  it("promises nothing while referral attribution is not live (QA-1 F-24): no link, no fetch, coming-soon copy", () => {
    attributionLive = false;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderPage();
    expect(screen.getByText("Referral rewards are coming soon")).toBeInTheDocument();
    expect(screen.queryByText("Your referral link")).not.toBeInTheDocument();
    expect(screen.queryByText(/earn a referral bonus/i)).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
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
    // Every funnel tile shows a real number, never blank space — and there is no
    // hard-coded "Clicks 0" tile (nothing tracks clicks).
    expect(screen.queryByText("Clicks")).not.toBeInTheDocument();
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

  it("MAP-20: shows a friendly message, not raw parser text, when the API answers with a non-JSON error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    renderPage();
    expect(await screen.findByText(/couldn't load your referral link/i)).toBeInTheDocument();
    expect(screen.queryByText(/Unexpected end of JSON/i)).not.toBeInTheDocument();
  });

  it("MAP-20: also survives a 200 with a non-JSON body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>oops</html>", { status: 200 })),
    );
    renderPage();
    expect(await screen.findByText(/couldn't load your referral link/i)).toBeInTheDocument();
  });
});
