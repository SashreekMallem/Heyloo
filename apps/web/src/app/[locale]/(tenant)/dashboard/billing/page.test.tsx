import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TenantIdProvider } from "@/lib/tenant/tenant-context";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "gte", "lt", "order", "limit", "maybeSingle"]) {
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
let tenantRow: Record<string, unknown> = { usage_hard_cap_minutes: null };
let usageEventRows: { minutes: number; occurred_at?: string }[] = [];
let invoiceRows: Record<string, unknown>[] = [];
let usageEventsChain: Record<string, ReturnType<typeof vi.fn>> | null = null;

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: {
    from: vi.fn((table: string) => {
      if (table === "usage_daily") return chain({ data: usageDailyRows, error: null });
      if (table === "tenants") {
        return chain({ data: tenantRow, error: null });
      }
      if (table === "usage_events") {
        usageEventsChain = chain({ data: usageEventRows, error: null }) as typeof usageEventsChain;
        return usageEventsChain;
      }
      if (table === "billing_invoices") {
        invoicesChain = chain({ data: invoiceRows, error: null }) as typeof invoicesChain;
        return invoicesChain;
      }
      return chain({ data: null, error: null });
    }),
  },
}));

import BillingPage, { freeTrialSummary } from "./page";

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

  it("does not list a not-yet-finalized `draft` invoice (QA-1 F-25)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ included_minutes: 100 })),
    );
    renderPage();
    await screen.findByText("No invoices yet");
    expect(invoicesChain?.["neq"]).toHaveBeenCalledWith("status", "draft");
  });
});

describe("BillingPage Manage payment method (QA-1 F-12)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    usageDailyRows = [];
  });

  function stubFetch(portal: () => Response | Promise<Response>) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/billing/portal" ? portal() : Response.json({ included_minutes: 100 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("redirects to the Stripe-hosted portal url when the endpoint returns one", async () => {
    stubFetch(() => Response.json({ url: "https://billing.stripe.com/p/session/abc" }));
    const location = { href: "http://localhost/dashboard/billing" };
    vi.stubGlobal("location", location);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Manage payment method" }));
    await waitFor(() => expect(location.href).toBe("https://billing.stripe.com/p/session/abc"));
  });

  it("shows an inline explanation with an email-support link (not a vanishing toast) when the portal is unavailable", async () => {
    stubFetch(() => Response.json({ error: "portal_unavailable" }, { status: 502 }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Manage payment method" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The billing portal is temporarily unavailable.");
    expect(screen.getByRole("link", { name: "Email support" })).toHaveAttribute(
      "href",
      expect.stringContaining("mailto:support@heyloo.com"),
    );
  });

  it("explains a non-owner and a no-billing-account state distinctly", async () => {
    stubFetch(() => Response.json({ error: "not_tenant_owner" }, { status: 403 }));
    const user = userEvent.setup();
    const { unmount } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Manage payment method" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the account owner");
    unmount();

    stubFetch(() => Response.json({ error: "no_billing_account" }, { status: 409 }));
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Manage payment method" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no billing account yet");
  });

  it("survives a non-JSON error body (e.g. the function is not deployed: 404 HTML)", async () => {
    stubFetch(() => new Response("<html>not found</html>", { status: 404 }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Manage payment method" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("temporarily unavailable");
  });
});

describe("BillingPage owner-only actions (QA-1 AUTH-15)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    usageDailyRows = [];
  });

  function renderAs(canWrite: boolean) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ included_minutes: 100 })),
    );
    return render(
      <TenantIdProvider tenantId="t1" canWrite={canWrite}>
        <QueryClientProvider client={new QueryClient()}>
          <BillingPage />
        </QueryClientProvider>
      </TenantIdProvider>,
    );
  }

  it("shows 'Manage payment method' to an owner or admin", async () => {
    renderAs(true);
    expect(
      await screen.findByRole("button", { name: "Manage payment method" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("billing-owner-only")).not.toBeInTheDocument();
  });

  it("replaces it with an explanation for a member, while usage stays visible read-only", async () => {
    renderAs(false);
    expect(await screen.findByTestId("billing-owner-only")).toHaveTextContent(
      "Ask your account owner to manage the payment method.",
    );
    expect(screen.queryByRole("button", { name: "Manage payment method" })).not.toBeInTheDocument();
    expect(screen.getByText("Usage this period")).toBeInTheDocument();
  });
});

describe("BillingPage free trial (TRIAL-1)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
    tenantRow = { usage_hard_cap_minutes: null };
    usageEventRows = [];
    invoiceRows = [];
    usageEventsChain = null;
  });

  function stubPlan() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ included_minutes: 300 })),
    );
  }

  it("explains a running trial: end date or minutes cap, minutes used, what is charged after", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-11T12:00:00Z"), toFake: ["Date"] });
    tenantRow = {
      usage_hard_cap_minutes: null,
      timezone: "America/Chicago",
      trial_ends_at: "2026-10-16T15:00:00Z",
      trial_minutes_cap: 100,
      trial_ended_reason: null,
    };
    usageEventRows = [{ minutes: 20.4 }, { minutes: 21.9 }];
    stubPlan();
    renderPage();
    const card = await screen.findByTestId("free-trial-card");
    expect(card).toHaveTextContent(
      "Your free trial ends on October 16, 2026 or when your AI receptionist has answered 100 minutes of calls, whichever comes first. 42 of 100 minutes used so far.",
    );
    expect(card).toHaveTextContent("the monthly plan price is charged to your card on file");
    expect(card).toHaveTextContent("Calls are never cut off.");
    expect(card).toHaveTextContent("use Manage payment method below");
    expect(
      await screen.findByText(/minutes used during your free trial are never billed as overage/i),
    ).toBeInTheDocument();
    // trial minutes = billable usage before the trial's end
    expect(usageEventsChain?.["eq"]).toHaveBeenCalledWith("is_billable", true);
    expect(usageEventsChain?.["lt"]).toHaveBeenCalledWith("occurred_at", "2026-10-16T15:00:00Z");
  });

  it("never shows trial minutes as plan usage or overage after a trial that ended mid-month", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-20T12:00:00Z"), toFake: ["Date"] });
    tenantRow = {
      usage_hard_cap_minutes: null,
      timezone: "America/Chicago",
      trial_ends_at: "2026-10-05T15:00:00Z",
      trial_minutes_cap: 100,
      trial_ended_reason: "minutes",
    };
    // 100 trial minutes (two in October, one on Sep 30 local time) + 260 after
    usageEventRows = [
      { minutes: 30, occurred_at: "2026-10-01T04:30:00Z" }, // Sep 30, 11:30 pm Chicago
      { minutes: 40, occurred_at: "2026-10-02T15:00:00Z" },
      { minutes: 30, occurred_at: "2026-10-04T15:00:00Z" },
    ];
    usageDailyRows = [{ billable_minutes: 70 }, { billable_minutes: 260 }];
    stubPlan();
    renderPage();
    // 330 in usage_daily this month - 70 trial minutes = 260, under the 300 included
    expect(await screen.findByText("260 of 300 minutes used")).toBeInTheDocument();
    expect(screen.queryByText(/min overage/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/The 70 free-trial minutes this month aren't counted here\./),
    ).toBeInTheDocument();
  });

  it("tells an owner who canceled during the trial that nothing will be charged", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-11T12:00:00Z"), toFake: ["Date"] });
    tenantRow = {
      usage_hard_cap_minutes: null,
      timezone: "America/Chicago",
      trial_ends_at: "2026-10-16T15:00:00Z",
      trial_minutes_cap: 100,
      trial_ended_reason: null,
      trial_cancel_scheduled: true,
    };
    usageEventRows = [{ minutes: 42, occurred_at: "2026-10-10T15:00:00Z" }];
    stubPlan();
    renderPage();
    const card = await screen.findByTestId("free-trial-card");
    expect(card).toHaveTextContent(
      "You canceled during your free trial, so your subscription ends when the trial ends on October 16, 2026 (42 of 100 trial minutes used). You won't be charged, and calls are answered until then.",
    );
    expect(card).not.toHaveTextContent("charged to your card");
  });

  it("shows no trial card and reads no trial usage for a tenant that never had a trial", async () => {
    stubPlan();
    renderPage();
    await screen.findByText("Usage this period");
    expect(screen.queryByTestId("free-trial-card")).not.toBeInTheDocument();
    expect(usageEventsChain).toBeNull();
  });

  it("labels a $0 invoice as no charge", async () => {
    invoiceRows = [
      {
        id: "i1",
        period_start: "2026-10-01",
        period_end: "2026-10-08",
        total_cents: 0,
        status: "paid",
      },
      {
        id: "i2",
        period_start: "2026-10-08",
        period_end: "2026-11-08",
        total_cents: 29900,
        status: "paid",
      },
    ];
    stubPlan();
    renderPage();
    expect((await screen.findAllByText("$0.00 (no charge)")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("$299.00").length).toBeGreaterThan(0);
  });
});

describe("freeTrialSummary (TRIAL-1)", () => {
  const base = {
    endsAt: "2026-10-16T15:00:00Z",
    endedReason: null,
    minutesCap: 100,
    minutesUsed: 12,
    timezone: "UTC",
  } as const;
  const now = new Date("2026-10-11T12:00:00Z");

  it("tells a member the owner can cancel", () => {
    expect(freeTrialSummary(base, { canManageBilling: false, now })).toContain(
      "Your account owner can cancel before you're charged.",
    );
  });

  it("never shows more minutes used than the cap", () => {
    expect(
      freeTrialSummary({ ...base, minutesUsed: 140 }, { canManageBilling: true, now }),
    ).toContain("100 of 100 minutes used so far.");
  });

  it("explains each way the trial can end", () => {
    expect(
      freeTrialSummary({ ...base, endedReason: "minutes" }, { canManageBilling: true, now }),
    ).toBe(
      "Your free trial ended early because its 100 call minutes were used, so your plan has started. Minutes used during the trial are never billed as overage.",
    );
    expect(
      freeTrialSummary({ ...base, endedReason: "time" }, { canManageBilling: true, now }),
    ).toBe(
      "Your free trial ended on October 16, 2026 and your plan started. Minutes used during the trial are never billed as overage.",
    );
    expect(
      freeTrialSummary({ ...base, endedReason: "canceled" }, { canManageBilling: true, now }),
    ).toBe("Your subscription was canceled during the free trial, so your plan was never charged.");
  });

  it("a canceled-during-trial owner is never told the plan starts or was charged", () => {
    const canceled = { ...base, cancelScheduled: true };
    expect(freeTrialSummary(canceled, { canManageBilling: true, now })).toContain(
      "You won't be charged",
    );
    expect(
      freeTrialSummary(canceled, {
        canManageBilling: true,
        now: new Date("2026-10-17T00:00:00Z"),
      }),
    ).toBe("Your subscription was canceled during the free trial, so your plan was never charged.");
  });

  it("treats a trial past its end as over even before the end is recorded", () => {
    expect(
      freeTrialSummary(base, { canManageBilling: true, now: new Date("2026-10-17T00:00:00Z") }),
    ).toContain("ended on October 16, 2026");
  });

  it("omits the minutes part when the cap is unknown", () => {
    const text = freeTrialSummary({ ...base, minutesCap: null }, { canManageBilling: true, now });
    expect(text).toContain("Your free trial ends on October 16, 2026. Then your plan starts");
    expect(text).not.toContain("minutes used so far");
  });
});
