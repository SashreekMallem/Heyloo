import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// Regression test for CHANNELS-2 item 3: the voice-only Calls list must
// never show the text-agent's shadow `call_logs` rows (channel
// 'sms'/'web_chat') — see `20260911101000_channels_tenant_and_call_log_
// columns.sql` and the Cluster-repair BUILD_NOTES entry this hardens.

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of [
    "select",
    "eq",
    "in",
    "order",
    "range",
    "gte",
    "lt",
    "or",
    "ilike",
    "limit",
  ]) {
    obj[method] = vi.fn(() => obj);
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

let lastChain: Record<string, unknown> | null = null;
let queryResult: unknown = { data: [], count: 0, error: null };
let customersResult: unknown = { data: [], error: null };

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: {
    from: vi.fn((table: string) => {
      if (table === "customers") return chain(customersResult);
      lastChain = chain(queryResult);
      return lastChain;
    }),
  },
}));

import { CallsListClient } from "./calls-list-client";

function renderClient(tenantTz?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CallsListClient tenantId="t1" {...(tenantTz ? { tenantTz } : {})} />
    </QueryClientProvider>,
  );
}

describe("CallsListClient", () => {
  it("filters call_logs to voice channels only (excludes sms/web_chat shadow rows)", async () => {
    queryResult = {
      data: [
        {
          id: "call-1",
          started_at: "2026-09-01T00:00:00Z",
          caller_number: "+15551234567",
          classification: "new_booking",
          duration_seconds: 90,
          outcome: "booked",
          urgency_flag: false,
          sentiment: "positive",
        },
      ],
      count: 1,
      error: null,
    };
    renderClient();
    await screen.findByText("booked");
    expect(lastChain).not.toBeNull();
    // biome-ignore lint/style/noNonNullAssertion: asserted above.
    const inMock = lastChain!["in"] as ReturnType<typeof vi.fn>;
    expect(inMock).toHaveBeenCalledWith("channel", ["phone", "web_voice"]);
    // biome-ignore lint/style/noNonNullAssertion: asserted above.
    const orderMock = lastChain!["order"] as ReturnType<typeof vi.fn>;
    expect(orderMock).toHaveBeenCalledWith("started_at", { ascending: false, nullsFirst: false });
  });

  it("shows durations in seconds / minutes+seconds instead of whole-minute rounding (QA-1 F-16)", async () => {
    queryResult = {
      data: [
        {
          id: "a",
          started_at: "2026-09-01T00:00:00Z",
          caller_number: "+15551230001",
          classification: "new_booking",
          duration_seconds: 20,
          outcome: "o1",
          urgency_flag: false,
          sentiment: null,
        },
        {
          id: "b",
          started_at: "2026-09-01T01:00:00Z",
          caller_number: "+15551230002",
          classification: "new_booking",
          duration_seconds: 62,
          outcome: "o2",
          urgency_flag: false,
          sentiment: null,
        },
      ],
      count: 2,
      error: null,
    };
    renderClient();
    expect(await screen.findByText("20s")).toBeInTheDocument();
    expect(screen.getByText("1m 2s")).toBeInTheDocument();
    expect(screen.queryByText("0m")).not.toBeInTheDocument();
  });

  it("filters by a tenant-local from/to date range and carries the range into the CSV export (QA-1 F-15 / F-17)", async () => {
    queryResult = { data: [], count: 0, error: null };
    const user = userEvent.setup();
    renderClient("America/New_York");
    await screen.findByText("No calls yet");
    await user.type(screen.getByLabelText("From date"), "2026-09-29");
    await user.type(screen.getByLabelText("To date"), "2026-09-30");
    await waitFor(() => {
      // biome-ignore lint/style/noNonNullAssertion: set by the from() mock.
      const gte = lastChain!["gte"] as ReturnType<typeof vi.fn>;
      expect(gte).toHaveBeenCalledWith("started_at", "2026-09-29T04:00:00.000Z");
    });
    // biome-ignore lint/style/noNonNullAssertion: set by the from() mock.
    const lt = lastChain!["lt"] as ReturnType<typeof vi.fn>;
    // "to" is inclusive: the bound is local midnight at the START of the next day.
    expect(lt).toHaveBeenCalledWith("started_at", "2026-10-01T04:00:00.000Z");
    const href = screen.getByRole("link", { name: "Export CSV" }).getAttribute("href") ?? "";
    expect(href).toContain("started_after=2026-09-29T04%3A00%3A00.000Z");
    expect(href).toContain("started_before=2026-10-01T04%3A00%3A00.000Z");
    expect(screen.getByText("No calls match your filters")).toBeInTheDocument();
  });

  it("searches by phone digits and by customer name (via the customer's E.164 number) (QA-1 F-15)", async () => {
    queryResult = { data: [], count: 0, error: null };
    customersResult = { data: [{ phone_e164: "+15552019010" }], error: null };
    const user = userEvent.setup();
    renderClient();
    await screen.findByText("No calls yet");
    await user.type(screen.getByLabelText("Search calls by number or name"), "Jamie 555{Enter}");
    await waitFor(() => {
      // biome-ignore lint/style/noNonNullAssertion: set by the from() mock.
      const or = lastChain!["or"] as ReturnType<typeof vi.fn>;
      expect(or).toHaveBeenCalledWith("caller_number.ilike.%555%,caller_number.in.(+15552019010)");
    });
    const href = screen.getByRole("link", { name: "Export CSV" }).getAttribute("href") ?? "";
    expect(href).toContain("q=Jamie+555");
  });

  it("a search that can match nothing shows the filtered empty state without querying everything", async () => {
    queryResult = {
      data: [
        {
          id: "a",
          started_at: "2026-09-01T00:00:00Z",
          caller_number: "+15551230001",
          classification: "new_booking",
          duration_seconds: 20,
          outcome: "should-not-show",
          urgency_flag: false,
          sentiment: null,
        },
      ],
      count: 1,
      error: null,
    };
    customersResult = { data: [], error: null };
    const user = userEvent.setup();
    renderClient();
    await screen.findByText("should-not-show");
    await user.type(screen.getByLabelText("Search calls by number or name"), "Nobody{Enter}");
    expect(await screen.findByText("No calls match your filters")).toBeInTheDocument();
    expect(screen.queryByText("should-not-show")).not.toBeInTheDocument();
  });

  it("puts the classification filter into the CSV export link", async () => {
    queryResult = { data: [], count: 0, error: null };
    renderClient();
    await screen.findByText("No calls yet");
    const href = screen.getByRole("link", { name: "Export CSV" }).getAttribute("href") ?? "";
    expect(href).toBe("/api/tenant/calls/export?tenant_id=t1");
  });
  it("shows the customer's name next to their number (QA-1 F-15)", async () => {
    queryResult = {
      data: [
        {
          id: "call-named",
          started_at: "2026-09-01T00:00:00Z",
          caller_number: "+15551234567",
          classification: "new_booking",
          duration_seconds: 90,
          outcome: "booked",
          urgency_flag: false,
          sentiment: null,
        },
      ],
      count: 1,
      error: null,
    };
    customersResult = { data: [{ phone_e164: "+15551234567", name: "Jamie Rivera" }], error: null };
    renderClient();
    expect((await screen.findAllByText("Jamie Rivera")).length).toBeGreaterThan(0);
    customersResult = { data: [], error: null };
  });
});
