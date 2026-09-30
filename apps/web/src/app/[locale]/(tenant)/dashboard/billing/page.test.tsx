import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TenantIdProvider } from "@/lib/tenant/tenant-context";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "gte", "order", "limit", "maybeSingle"]) {
    obj[method] = vi.fn(() => obj);
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

let invoicesChain: Record<string, ReturnType<typeof vi.fn>> | null = null;
let usageDailyRows: { billable_minutes: number | null; text_messages_out?: number | null }[] = [];

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: {
    from: vi.fn((table: string) => {
      if (table === "usage_daily") return chain({ data: usageDailyRows, error: null });
      if (table === "tenants") {
        return chain({ data: { usage_hard_cap_minutes: null }, error: null });
      }
      if (table === "billing_invoices") {
        invoicesChain = chain({ data: [], error: null }) as typeof invoicesChain;
        return invoicesChain;
      }
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

describe("BillingPage text conversations usage tile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    usageDailyRows = [];
  });

  it("sums text_messages_out across the period and shows the plan's included allowance", async () => {
    usageDailyRows = [
      { billable_minutes: 10, text_messages_out: 30 },
      { billable_minutes: 5, text_messages_out: 45 },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          included_minutes: 300,
          usage_alert_thresholds: { warn_pct: 0.8, critical_pct: 1.0 },
          included_text_conversations: 200,
          text_conversation_overage_cents: 5,
        }),
      ),
    );

    renderPage();

    expect(await screen.findByText("75 of 200 AI text replies used")).toBeInTheDocument();
    expect(screen.queryByText(/over ·/)).not.toBeInTheDocument();
  });

  it("shows overage cost once usage exceeds the included allowance", async () => {
    usageDailyRows = [{ billable_minutes: 1, text_messages_out: 210 }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          included_minutes: 300,
          usage_alert_thresholds: { warn_pct: 0.8, critical_pct: 1.0 },
          included_text_conversations: 200,
          text_conversation_overage_cents: 5,
        }),
      ),
    );

    renderPage();

    expect(await screen.findByText("210 of 200 AI text replies used")).toBeInTheDocument();
    expect(screen.getByText("+10 over · $0.50")).toBeInTheDocument();
  });

  it("defaults to 200 included / 5¢ overage when the plan lookup omits the new fields", async () => {
    usageDailyRows = [{ billable_minutes: 1, text_messages_out: 12 }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          included_minutes: 300,
          usage_alert_thresholds: { warn_pct: 0.8, critical_pct: 1.0 },
        }),
      ),
    );

    renderPage();

    expect(await screen.findByText("12 of 200 AI text replies used")).toBeInTheDocument();
  });

  it("never lists the internal `void` markers as invoices", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ included_minutes: 100 })),
    );
    renderPage();
    await screen.findByText("No invoices yet");
    expect(invoicesChain?.["neq"]).toHaveBeenCalledWith("status", "void");
  });

  it("BILL-8: does not claim usage alerts are on while nothing sends them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ included_minutes: 100 })),
    );
    renderPage();
    expect(await screen.findAllByText(/Not sending yet/)).toHaveLength(2);
    expect(screen.queryByText(/On \(platform default\)/)).not.toBeInTheDocument();
  });

  it("BILL-9: tells the owner why the payment portal did not open", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("/api/billing/portal")
        ? Response.json({ error: "no_billing_account" }, { status: 409 })
        : Response.json({ included_minutes: 100 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Manage payment method" }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringContaining("billing account")),
    );
  });
});
