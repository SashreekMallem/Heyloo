import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@heyloo/ui/charts", () => ({
  LatencyPercentileChart: () => <div data-testid="latency-chart" />,
}));

const { default: BottlenecksPage } = await import("./page");

const POINT = { label: "10:00", p50: 100, p95: 300, p99: 500, errorRate: 0.1 };

function renderWith(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(body)),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BottlenecksPage />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

// COCKPIT-F11: the title promised an error rate but the page never showed one.
describe("Tool latency & error rate", () => {
  it("shows each tool's error rate and top failure reason next to its chart", async () => {
    renderWith({
      byTool: { create_booking: [POINT], lookup_customer: [POINT] },
      tools: [
        {
          tool_name: "create_booking",
          calls: 10,
          error_rate: 0.3,
          p95_ms: 400,
          top_error_type: "timeout",
        },
        {
          tool_name: "lookup_customer",
          calls: 1,
          error_rate: 0,
          p95_ms: 90,
          top_error_type: null,
        },
      ],
    });
    expect(await screen.findByText("30.0% errors")).toBeInTheDocument();
    expect(screen.getByText("10 calls in the last hour")).toBeInTheDocument();
    expect(screen.getByText("timeout")).toBeInTheDocument();
    expect(screen.getByText("0.0% errors")).toBeInTheDocument();
    expect(screen.getByText("1 call in the last hour")).toBeInTheDocument();
    expect(screen.getAllByTestId("latency-chart")).toHaveLength(2);
  });

  it("says so when a tool had no calls in the last hour", async () => {
    renderWith({ byTool: { create_booking: [POINT] }, tools: [] });
    expect(await screen.findByText("No calls in the last hour")).toBeInTheDocument();
  });
});
