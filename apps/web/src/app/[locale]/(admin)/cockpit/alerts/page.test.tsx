import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess } }));

const { default: AlertsPage } = await import("./page");

const ALERT_ID = "0a0a0a0a-0000-4000-8000-000000000001";
const RULE_ID = "0b0b0b0b-0000-4000-8000-000000000001";

const OPEN_ALERTS = [
  {
    id: ALERT_ID,
    rule: "negative_margin",
    severity: "warning",
    tenant_id: "0c0c0c0c-0000-4000-8000-000000000001",
    tenant_name: "Riverside Auto Repair",
    payload: { margin_cents: -500, period: "last_month" },
    status: "open",
    created_at: "2026-09-29T10:00:00Z",
  },
  {
    id: "0a0a0a0a-0000-4000-8000-000000000002",
    rule: "tool_failure_spike",
    severity: "critical",
    tenant_id: null,
    tenant_name: null,
    payload: { tool_name: "book_appointment", total: 10, errors: 5 },
    status: "open",
    created_at: "2026-09-29T10:05:00Z",
  },
];

const RULES = [
  {
    id: RULE_ID,
    metric: "negative_margin",
    operator: "lt",
    value: 0,
    enabled: true,
    channel: "dashboard_only",
  },
];

type Call = { url: string; method: string };

function stubApi(ackStatus = 200) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url: String(url), method });
      if (method === "PATCH" && String(url).endsWith("/ack")) {
        return Response.json({ acked: true }, { status: ackStatus });
      }
      if (method === "DELETE") return Response.json({ deleted: true });
      if (String(url).endsWith("admin-alerts/rules")) return Response.json({ rules: RULES });
      return Response.json({ alerts: OPEN_ALERTS });
    }),
  );
  return calls;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AlertsPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  toastError.mockClear();
  toastSuccess.mockClear();
});

describe("Alerts page", () => {
  it("F07: lists the open alerts with severity, tenant and details", async () => {
    stubApi();
    renderPage();
    const row = await screen.findByRole("row", { name: /Riverside Auto Repair/ });
    expect(within(row).getByText("warning")).toBeInTheDocument();
    expect(within(row).getByText(/margin cents: -500/)).toBeInTheDocument();
    // a platform-wide alert has no tenant
    expect(screen.getByText("Platform")).toBeInTheDocument();
    expect(screen.getByText("critical")).toBeInTheDocument();
  });

  it("F07: Ack PATCHes admin-alerts/:id/ack and refetches the list", async () => {
    const calls = stubApi();
    renderPage();
    await userEvent.click(
      await screen.findByRole("button", { name: "Acknowledge negative margin alert" }),
    );
    await waitFor(() =>
      expect(calls).toContainEqual({
        url: `/api/admin/admin-alerts/${ALERT_ID}/ack`,
        method: "PATCH",
      }),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Alert acknowledged"));
    const listReads = calls.filter((c) => c.method === "GET" && c.url.endsWith("admin-alerts"));
    expect(listReads.length).toBeGreaterThanOrEqual(2);
  });

  it("F07: a failed Ack tells the admin", async () => {
    stubApi(500);
    renderPage();
    await userEvent.click(
      await screen.findByRole("button", { name: "Acknowledge negative margin alert" }),
    );
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });

  it("F24: no Test button; Delete asks for confirmation then sends DELETE", async () => {
    const calls = stubApi();
    renderPage();
    await screen.findByText("Riverside Auto Repair");
    expect(screen.queryByRole("button", { name: /test/i })).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole("button", { name: /delete/i }));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await userEvent.click(await screen.findByRole("button", { name: "Delete rule" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        url: `/api/admin/admin-alerts/rules/${RULE_ID}`,
        method: "DELETE",
      }),
    );
  });
});
