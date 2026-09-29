import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess } }));
vi.mock("@/lib/impersonation/state", () => ({ startImpersonation: vi.fn() }));
vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));

const { default: TenantDetailPage } = await import("./page");

const TENANT_ID = "00000000-0000-4000-8000-000000000001";
// `use(params)` needs a stable promise (a fresh one per render suspends forever).
const PARAMS = Promise.resolve({ id: TENANT_ID });

const detail = (status: string, metrics: Record<string, unknown> = {}) => ({
  tenant: {
    id: TENANT_ID,
    name: "Riverside Auto Repair",
    status,
    plan_code: "standard",
    vertical: "auto",
  },
  metrics: {
    mrr_cents: null,
    list_price_cents: 29900,
    margin_pct: null,
    minutes_used: 3.6,
    ...metrics,
  },
});

type Call = { url: string; method: string; body: unknown };

function stubApi(
  tenantResponse: () => Response,
  patchStatus = 200,
): { calls: Call[]; patches: Call[] } {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: Call = {
        url: String(url),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      if (call.method === "PATCH") return Response.json({ tenant: {} }, { status: patchStatus });
      if (String(url).includes("per-customer-margin")) return Response.json({ calls: [] });
      return tenantResponse();
    }),
  );
  return { calls, patches: calls };
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Suspense fallback={null}>
        <TenantDetailPage params={PARAMS} />
      </Suspense>
    </QueryClientProvider>,
  );
}

/** `use(params)` suspends on first render; the mount has to happen inside an awaited act. */
async function renderPage() {
  await act(async () => {
    mount();
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  toastError.mockClear();
  toastSuccess.mockClear();
});

describe("tenant detail metrics", () => {
  it("F12/F14: no margin, no MRR and a rounded minutes value for an unsubscribed tenant", async () => {
    stubApi(() => Response.json(detail("active")));
    await renderPage();
    expect(await screen.findByText("Riverside Auto Repair")).toBeInTheDocument();
    // MRR and Margin % both read "No data", never $299.00 / 0.0%
    expect(screen.getAllByText("No data")).toHaveLength(2);
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
    expect(screen.queryByText("$299.00")).not.toBeInTheDocument();
    expect(
      screen.getByText(/No active subscription · list price \$299\.00\/mo/),
    ).toBeInTheDocument();
    expect(screen.getByText("3.6")).toBeInTheDocument();
  });

  it("shows real figures for a subscribed tenant", async () => {
    stubApi(() => Response.json(detail("active", { mrr_cents: 29900, margin_pct: 75.25 })));
    await renderPage();
    expect(await screen.findByText("$299.00")).toBeInTheDocument();
    expect(screen.getByText("75.3%")).toBeInTheDocument();
    expect(screen.queryByText(/No active subscription/)).not.toBeInTheDocument();
  });
});

describe("suspend / resume (COCKPIT-F16)", () => {
  it("cannot suspend without a reason, then PATCHes status + reason", async () => {
    const { calls } = stubApi(() => Response.json(detail("active")));
    await renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Suspend" }));
    const confirm = await screen.findByRole("button", { name: "Suspend tenant" });
    expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Suspension reason"), "chargeback dispute");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.url).toBe(`/api/admin/admin-tenants/${TENANT_ID}`);
    expect(patch?.body).toEqual({ status: "paused", reason: "chargeback dispute" });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Tenant suspended"));
  });

  it("keeps the dialog and the typed reason when the request fails", async () => {
    stubApi(() => Response.json(detail("active")), 500);
    await renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Suspend" }));
    await userEvent.type(await screen.findByLabelText("Suspension reason"), "fraud");
    await userEvent.click(screen.getByRole("button", { name: "Suspend tenant" }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByLabelText("Suspension reason")).toHaveValue("fraud");
  });

  it("offers Resume (not Suspend) for a paused tenant and PATCHes status active", async () => {
    const { calls } = stubApi(() => Response.json(detail("paused")));
    await renderPage();
    expect(await screen.findByRole("button", { name: "Resume tenant" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suspend" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Resume tenant" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ status: "active" });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Tenant resumed"));
  });

  it("impersonation also needs a reason before the confirm button works", async () => {
    stubApi(() => Response.json(detail("active")));
    await renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Impersonate" }));
    expect(await screen.findByRole("button", { name: "Start impersonation" })).toBeDisabled();
  });
});

describe("unknown tenant (COCKPIT-F17)", () => {
  it("shows a friendly not-found, not admin_query_failed, and no dependent Recent calls card", async () => {
    const { calls } = stubApi(() => new Response("{}", { status: 404 }));
    await renderPage();
    expect(await screen.findByText("Not found.")).toBeInTheDocument();
    expect(screen.queryByText(/admin_query_failed/)).not.toBeInTheDocument();
    expect(screen.queryByText("Recent calls")).not.toBeInTheDocument();
    expect(screen.queryByText("No calls this quarter.")).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.includes("per-customer-margin"))).toBe(false);
  });
});
