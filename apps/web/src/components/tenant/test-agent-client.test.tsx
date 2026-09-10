import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "maybeSingle", "update"]) {
    obj[method] = vi.fn(() => obj);
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

const startCallMock = vi.fn(async () => undefined);
const stopCallMock = vi.fn();
const retellOnHandlers: Record<string, (...args: unknown[]) => void> = {};
const retellWebClientMock = vi.fn(function RetellWebClient(this: unknown) {
  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      retellOnHandlers[event] = handler;
    }),
    startCall: startCallMock,
    stopCall: stopCallMock,
  };
});

vi.mock("retell-client-js-sdk", () => ({
  RetellWebClient: retellWebClientMock,
}));

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: {
    from: vi.fn((table: string) => {
      if (table === "tenants") return chain({ data: { owner_test_phone: null }, error: null });
      if (table === "call_logs") return chain({ data: null, error: null });
      return chain({ data: null, error: null });
    }),
  },
}));

import { TestAgentClient } from "./test-agent-client";

function renderClient(overrides: Partial<Parameters<typeof TestAgentClient>[0]> = {}) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <TestAgentClient
        tenantId="t1"
        vertical="dental"
        phoneNumberId="p1"
        liveNumber="+15559990000"
        forwardingVerified={false}
        agentPublished={true}
        {...overrides}
      />
    </QueryClientProvider>,
  );
}

describe("TestAgentClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    startCallMock.mockClear();
    stopCallMock.mockClear();
    retellWebClientMock.mockClear();
    for (const key of Object.keys(retellOnHandlers)) delete retellOnHandlers[key];
  });

  it("shows per-vertical scenarios and a publish warning when the agent isn't published", async () => {
    renderClient({ agentPublished: false });
    expect(await screen.findByText("Book a cleaning")).toBeInTheDocument();
    expect(screen.getByText(/publish it first/)).toBeInTheDocument();
  });

  it("degrades honestly when the web-call backend is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ error: "not_implemented" }), { status: 501 }),
      ),
    );
    renderClient();
    const button = await screen.findByRole("button", { name: /start a web call test/i });
    await userEvent.click(button);
    expect(await screen.findByText(/isn't available yet/)).toBeInTheDocument();
  });

  it("establishes a browser audio session with the token the backend returns", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ access_token: "tok_abc123", call_id: "call_1" }), {
            status: 200,
          }),
      ),
    );
    renderClient();
    const button = await screen.findByRole("button", { name: /start a web call test/i });
    await userEvent.click(button);

    await waitFor(() => expect(retellWebClientMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(startCallMock).toHaveBeenCalledWith({ accessToken: "tok_abc123" }));

    retellOnHandlers["call_started"]?.();
    expect(await screen.findByText(/call in progress/i)).toBeInTheDocument();

    retellOnHandlers["call_ended"]?.();
    expect(await screen.findByText(/call ended/i)).toBeInTheDocument();
  });

  it("never shows the 'turn on forwarding' CTA before a test call has completed", async () => {
    renderClient();
    expect(await screen.findByText("Book a cleaning")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /turn on forwarding/i })).not.toBeInTheDocument();
  });
});
