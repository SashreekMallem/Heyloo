import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// overview-client.tsx pulls in `@/i18n/navigation` (next-intl) and a
// module-scope Supabase browser client singleton (`@/lib/supabase/browser`)
// as side effects of import — irrelevant to this file's actual target
// (the pure `usageDailyToTrend` adapter) and either unresolvable or
// unconfigured in this test environment, so both are mocked out the same
// way `test-agent-client.test.tsx` / `billing/page.test.tsx` do.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "gte", "order", "limit"]) {
    obj[method] = vi.fn(() => obj);
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

const callLogsChains: Record<string, unknown>[] = [];

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: {
    from: vi.fn((table: string) => {
      if (table === "usage_daily") return chain({ data: [], error: null });
      if (table === "call_logs") {
        const c = chain({ data: [], count: 0, error: null });
        callLogsChains.push(c);
        return c;
      }
      return chain({ data: [], error: null });
    }),
  },
}));

vi.mock("@/components/tenant/setup-progress-panel", () => ({
  SetupProgressPanel: () => null,
}));

import { OverviewClient, usageDailyToTrend } from "./overview-client";

function renderOverview() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <OverviewClient tenantId="t1" hasPhoneNumber={true} hasAnyCallEver={true} liveNumber={null} />
    </QueryClientProvider>,
  );
}

describe("OverviewClient — call_logs channel filtering (CHANNELS-2 item 3)", () => {
  it("filters both the spam-deflected count and the recent-calls widget to voice channels only", async () => {
    global.fetch = vi.fn(async () => ({ ok: false }) as Response);
    renderOverview();
    await screen.findByText("Recent calls");
    // Both call_logs queries (spam-deflected count inside the usage query,
    // and the recent-calls widget) must exclude the text-agent's shadow
    // rows — see calls-list-client.test.tsx for the same regression.
    expect(callLogsChains.length).toBeGreaterThanOrEqual(2);
    for (const c of callLogsChains) {
      const inMock = c["in"] as ReturnType<typeof vi.fn>;
      expect(inMock).toHaveBeenCalledWith("channel", ["phone", "web_voice"]);
    }
  });
});

describe("usageDailyToTrend", () => {
  it("maps usage_daily rows to the {label, value} shape TrendChart expects", () => {
    const rows = [
      { date: "2026-09-01", total_calls: 6 },
      { date: "2026-09-02", total_calls: 9 },
    ];
    expect(usageDailyToTrend(rows)).toEqual([
      { label: "09-01", value: 6 },
      { label: "09-02", value: 9 },
    ]);
  });

  it("coerces a null total_calls to 0 instead of passing null through", () => {
    const rows = [{ date: "2026-09-03", total_calls: null }];
    expect(usageDailyToTrend(rows)).toEqual([{ label: "09-03", value: 0 }]);
  });

  it("returns an empty array for no rows (the chart's own empty-domain fallback handles the rest)", () => {
    expect(usageDailyToTrend([])).toEqual([]);
  });
});
