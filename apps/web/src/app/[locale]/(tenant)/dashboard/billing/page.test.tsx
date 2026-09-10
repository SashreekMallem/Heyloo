import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TenantIdProvider } from "@/lib/tenant/tenant-context";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "order", "limit", "maybeSingle"]) {
    obj[method] = vi.fn(() => obj);
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

let usageDailyRows: { billable_minutes: number | null }[] = [];

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: {
    from: vi.fn((table: string) => {
      if (table === "usage_daily") return chain({ data: usageDailyRows, error: null });
      if (table === "tenants") {
        return chain({ data: { usage_hard_cap_minutes: null }, error: null });
      }
      if (table === "billing_invoices") return chain({ data: [], error: null });
      return chain({ data: null, error: null });
    }),
  },
}));

import BillingPage from "./page";

function renderPage() {
  const client = new QueryClient();
  return render(
    <TenantIdProvider tenantId="t1">
      <QueryClientProvider client={client}>
        <BillingPage />
      </QueryClientProvider>
    </TenantIdProvider>,
  );
}

describe("BillingPage usage card", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    usageDailyRows = [];
  });

  it("never renders NaN and shows 'Unlimited' when the plan has 0 included minutes but real usage exists", async () => {
    // A null billable_minutes row (e.g. a not-yet-aggregated day) must
    // never turn the total into NaN.
    usageDailyRows = [{ billable_minutes: 45 }, { billable_minutes: null }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          included_minutes: 0,
          usage_alert_thresholds: { warn_pct: 0.8, critical_pct: 1.0 },
        }),
      ),
    );

    renderPage();

    expect(await screen.findByText("45 minutes used · Unlimited")).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it("shows a plain '0 of 0' when the plan lookup fails and there's no usage yet", async () => {
    usageDailyRows = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "not_found" }, { status: 404 })),
    );

    renderPage();

    expect(await screen.findByText("0 of 0 minutes used")).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });
});
