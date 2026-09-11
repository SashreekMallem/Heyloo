import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Regression test for CHANNELS-2 item 3: the voice-only Calls list must
// never show the text-agent's shadow `call_logs` rows (channel
// 'sms'/'web_chat') — see `20260911101000_channels_tenant_and_call_log_
// columns.sql` and the Cluster-repair BUILD_NOTES entry this hardens.

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "range"]) {
    obj[method] = vi.fn(() => obj);
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

let lastChain: Record<string, unknown> | null = null;
let queryResult: unknown = { data: [], count: 0, error: null };

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: {
    from: vi.fn(() => {
      lastChain = chain(queryResult);
      return lastChain;
    }),
  },
}));

import { CallsListClient } from "./calls-list-client";

function renderClient() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <CallsListClient tenantId="t1" />
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
});
