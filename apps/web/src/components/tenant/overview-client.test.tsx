import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

type Call = [string, unknown[]];

interface RecordedChain {
  table: string;
  calls: Call[];
  has(method: string, ...args: unknown[]): boolean;
}

const chains: RecordedChain[] = [];
let usageRows: unknown[] = [];
let todayCallRows: { duration_seconds: number }[] = [];
let todayCallCount = 0;
let todayBookingCount = 0;
let recentRows: unknown[] = [];

function resultFor(c: RecordedChain) {
  const select = c.calls.find(([m]) => m === "select");
  const cols = String(select?.[1][0] ?? "");
  if (c.table === "usage_daily") return { data: usageRows, error: null };
  if (c.table === "bookings") return { data: null, count: todayBookingCount, error: null };
  if (c.table === "call_logs") {
    if (cols === "duration_seconds") {
      return { data: todayCallRows, count: todayCallCount, error: null };
    }
    if (cols.startsWith("id, caller_number")) return { data: recentRows, error: null };
    return { data: null, count: 0, error: null };
  }
  return { data: [], error: null };
}

function chain(table: string) {
  const c: RecordedChain = {
    table,
    calls: [],
    has: (method, ...args) =>
      c.calls.some(([m, a]) => m === method && args.every((x, i) => a[i] === x)),
  };
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "gte", "order", "limit"]) {
    obj[method] = vi.fn((...args: unknown[]) => {
      c.calls.push([method, args]);
      return obj;
    });
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(resultFor(c)).then(resolve, reject);
  chains.push(c);
  return obj;
}

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: {
    from: vi.fn((table: string) => chain(table)),
  },
}));

vi.mock("@/components/tenant/setup-progress-panel", () => ({
  SetupProgressPanel: () => null,
}));

import { OverviewClient, usageDailyToTrend, withLiveToday } from "./overview-client";

function renderOverview(tenantTz = "America/New_York") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OverviewClient
        tenantId="t1"
        tenantTz={tenantTz}
        hasPhoneNumber={true}
        hasAnyCallEver={true}
        liveNumber={null}
      />
    </QueryClientProvider>,
  );
}

function metric(label: string): HTMLElement {
  return screen.getByText(label).parentElement?.parentElement as HTMLElement;
}

beforeEach(() => {
  chains.length = 0;
  usageRows = [];
  todayCallRows = [];
  todayCallCount = 0;
  todayBookingCount = 0;
  recentRows = [];
  global.fetch = vi.fn(async () => ({ ok: false }) as Response);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("OverviewClient — call_logs channel filtering (CHANNELS-2 item 3)", () => {
  it("filters every call_logs query (spam count, today's calls, recent-calls widget) to voice channels only", async () => {
    renderOverview();
    await screen.findByText("Recent calls");
    await waitFor(() =>
      expect(chains.filter((c) => c.table === "call_logs").length).toBeGreaterThanOrEqual(3),
    );
    for (const c of chains.filter((x) => x.table === "call_logs")) {
      expect(c.has("in", "channel")).toBe(true);
      expect(c.calls.find(([m]) => m === "in")?.[1]).toEqual(["channel", ["phone", "web_voice"]]);
    }
  });
});

describe("OverviewClient — live 'today' cards (QA-1 F-02 / F-21)", () => {
  it("counts today's calls, bookings and minutes from the source tables even when usage_daily has no row for today", async () => {
    // usage_daily is stale (ends 2 days ago) — the exact production symptom.
    usageRows = [{ date: "2026-09-27", total_calls: 4, billable_minutes: 10, total_bookings: 1 }];
    todayCallRows = [{ duration_seconds: 20 }, { duration_seconds: 62 }];
    todayCallCount = 2;
    todayBookingCount = 3;
    renderOverview();
    await waitFor(() => expect(metric("Calls today")).toHaveTextContent("2"));
    expect(metric("Bookings today")).toHaveTextContent("3");
    // 10 prior minutes from the rollup + ceil(82s / 60) = 2 live minutes.
    expect(metric("Minutes used")).toHaveTextContent("12");
  });

  it("bounds 'today' by the tenant-local midnight, not the UTC date, and excludes test rows", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 01:30 UTC on Sep 30 is still the evening of Sep 29 in New York.
    vi.setSystemTime(new Date("2026-09-30T01:30:00Z"));
    renderOverview("America/New_York");
    await screen.findByText("Recent calls");
    await waitFor(() => expect(chains.some((c) => c.table === "bookings")).toBe(true));
    const todayCalls = chains.find(
      (c) =>
        c.table === "call_logs" &&
        c.calls.find(([m]) => m === "select")?.[1][0] === "duration_seconds",
    );
    expect(todayCalls?.has("gte", "started_at", "2026-09-29T04:00:00.000Z")).toBe(true);
    expect(todayCalls?.has("eq", "is_test_call", false)).toBe(true);
    const bookings = chains.find((c) => c.table === "bookings");
    expect(bookings?.has("gte", "created_at", "2026-09-29T04:00:00.000Z")).toBe(true);
    expect(bookings?.has("eq", "is_test", false)).toBe(true);
  });
});

describe("OverviewClient — date-range pills drive Recent calls (QA-1 F-14)", () => {
  it("re-queries recent calls with the range start when the pill changes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T16:00:00Z"));
    renderOverview("UTC");
    const recentChain = () =>
      chains.filter(
        (c) =>
          c.calls.find(([m]) => m === "select")?.[1][0] ===
          "id, caller_number, classification, started_at, duration_seconds",
      );
    await waitFor(() => expect(recentChain().length).toBe(1));
    // default 7d = today + 6 previous days
    expect(recentChain()[0]?.has("gte", "started_at", "2026-09-24T00:00:00.000Z")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    await waitFor(() => expect(recentChain().length).toBe(2));
    expect(recentChain()[1]?.has("gte", "started_at", "2026-09-30T00:00:00.000Z")).toBe(true);
  });
});

describe("withLiveToday (QA-1 F-02)", () => {
  it("appends today's live count when the rollup has no row for today", () => {
    expect(withLiveToday([{ label: "09-27", value: 4 }], "2026-09-29", 2)).toEqual([
      { label: "09-27", value: 4 },
      { label: "09-29", value: 2 },
    ]);
  });
  it("overrides a stale rollup row for today", () => {
    expect(withLiveToday([{ label: "09-29", value: 1 }], "2026-09-29", 5)).toEqual([
      { label: "09-29", value: 5 },
    ]);
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
