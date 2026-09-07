import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const subscribeCallbacks: ((status: string) => void)[] = [];
const onHandlers: ((payload: { payload: { table: string; op: string; id: string } }) => void)[] =
  [];

const mockChannel = {
  on: vi.fn(function (this: unknown, _type: string, _filter: unknown, handler: never) {
    onHandlers.push(handler);
    return mockChannel;
  }),
  subscribe: vi.fn((cb: (status: string) => void) => {
    subscribeCallbacks.push(cb);
    return mockChannel;
  }),
};

vi.mock("@/lib/supabase/browser.js", () => ({
  supabaseBrowserClient: {
    channel: vi.fn(() => mockChannel),
    removeChannel: vi.fn(),
  },
}));

import { TenantRealtimeProvider, useTenantRealtimeStatus } from "./tenant-realtime-provider";

function StatusProbe() {
  const status = useTenantRealtimeStatus();
  return <p>status:{status}</p>;
}

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient();
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

describe("TenantRealtimeProvider", () => {
  it("starts in connecting state", () => {
    renderWithClient(
      <TenantRealtimeProvider tenantId="t1">
        <StatusProbe />
      </TenantRealtimeProvider>,
    );
    expect(screen.getByText("status:connecting")).toBeInTheDocument();
  });

  it("transitions to connected on SUBSCRIBED", async () => {
    renderWithClient(
      <TenantRealtimeProvider tenantId="t1">
        <StatusProbe />
      </TenantRealtimeProvider>,
    );
    const cb = subscribeCallbacks.at(-1);
    cb?.("SUBSCRIBED");
    expect(await screen.findByText("status:connected")).toBeInTheDocument();
  });

  it("invalidates the matching tenant-scoped query on a broadcast", async () => {
    const { client } = renderWithClient(
      <TenantRealtimeProvider tenantId="t1">
        <StatusProbe />
      </TenantRealtimeProvider>,
    );
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const handler = onHandlers.at(-1);
    handler?.({ payload: { table: "call_logs", op: "insert", id: "c1" } });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["tenant", "t1", "call_logs"] });
  });

  it("moves to reconnecting on CHANNEL_ERROR", async () => {
    renderWithClient(
      <TenantRealtimeProvider tenantId="t1">
        <StatusProbe />
      </TenantRealtimeProvider>,
    );
    const cb = subscribeCallbacks.at(-1);
    cb?.("CHANNEL_ERROR");
    expect(await screen.findByText("status:reconnecting")).toBeInTheDocument();
  });
});
