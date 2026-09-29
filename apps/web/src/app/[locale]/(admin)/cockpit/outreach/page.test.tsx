import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@heyloo/ui/charts", () => ({
  FunnelChart: ({ stages }: { stages: { label: string; count: number }[] }) => (
    <ul aria-label="funnel">
      {stages.map((s) => (
        <li key={s.label}>{`${s.label}: ${s.count}`}</li>
      ))}
    </ul>
  ),
}));

const { default: OutreachOverviewPage } = await import("./page");

/** Real `GET admin-outreach/funnel` shape (supabase/functions/admin/handler.ts). */
const FUNNEL = {
  leads_by_status: [
    { status: "new", count: 30 },
    { status: "sent", count: 6 },
    { status: "replied", count: 2 },
    { status: "converted", count: 1 },
  ],
  replies_by_intent: [{ ai_intent: "interested", count: 2 }],
  complaint_rate_pct: 0.25,
};

function stubApi(channels: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).endsWith("admin-cac") ? Response.json({ channels }) : Response.json(FUNNEL),
    ),
  );
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OutreachOverviewPage />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

// COCKPIT-F09: the page read {funnel, cacSummaryCents, complaintRatePct}, none of which the API returns.
describe("Outreach overview", () => {
  it("renders the funnel stages, CAC and complaint rate from the real response shapes", async () => {
    stubApi([{ channel: "outreach", total_cost_cents: 24000, converted_tenant_count: 2 }]);
    renderPage();
    expect(await screen.findByText("Sourced: 39")).toBeInTheDocument();
    expect(screen.getByText("Contacted: 9")).toBeInTheDocument();
    expect(screen.getByText("Converted: 1")).toBeInTheDocument();
    expect(await screen.findByText("$120.00")).toBeInTheDocument();
    expect(screen.getByText("0.3%")).toBeInTheDocument();
    expect(screen.queryByText("No funnel data yet")).not.toBeInTheDocument();
  });

  it("warns above the 0.2% complaint threshold", async () => {
    stubApi([]);
    renderPage();
    expect(await screen.findByText(/Complaint rate at 0\.25%/)).toBeInTheDocument();
  });

  it("shows 'No data' for CAC while nothing has converted", async () => {
    stubApi([{ channel: "outreach", total_cost_cents: 24000, converted_tenant_count: 0 }]);
    renderPage();
    await screen.findByText("Sourced: 39");
    expect(await screen.findByText("No data")).toBeInTheDocument();
  });
});
