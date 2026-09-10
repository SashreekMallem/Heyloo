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
vi.mock("@/lib/supabase/browser", () => ({ supabaseBrowserClient: { from: vi.fn() } }));

import { usageDailyToTrend } from "./overview-client";

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
