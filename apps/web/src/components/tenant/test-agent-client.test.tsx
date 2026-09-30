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

let latestCallData: unknown = null;
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
      if (table === "call_logs") return chain({ data: latestCallData, error: null });
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
    latestCallData = null;
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

  it("QA-1 F-17: typing letters in the test phone box is an error, not a silent 'Test number removed'", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderClient();
    const input = await screen.findByLabelText(/Your phone number/);
    await userEvent.type(input, "abc");
    expect(input).toHaveValue("abc");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Enter a full phone number/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("QA-1 F-17: a real number is sent to the route as typed (the route normalizes to E.164)", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true, owner_test_phone: "+16105550100" }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderClient();
    const input = await screen.findByLabelText(/Your phone number/);
    await userEvent.type(input, "(610) 555-0100");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/tenant/settings/test-phone");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      owner_test_phone: "(610) 555-0100",
    });
    await waitFor(() => expect(input).toHaveValue("+16105550100"));
  });

  it("never shows the 'turn on forwarding' CTA before a test call has completed", async () => {
    renderClient();
    expect(await screen.findByText("Book a cleaning")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /turn on forwarding/i })).not.toBeInTheDocument();
  });

  it("renders a real provider-shaped transcript (role/content/words) with speakers and timestamps, not NaN:NaN (QA-1 F-3 / MAP-02)", async () => {
    latestCallData = {
      id: "call-1",
      started_at: "2026-09-29T15:30:00Z",
      ended_at: "2026-09-29T15:31:00Z",
      classification: "new_booking",
      call_summary: null,
      message_text: null,
      structured_booking_payload: null,
      duration_seconds: 60,
      transcript: [
        { role: "agent", content: "Thanks for calling!", words: [{ word: "Thanks", start: 0.5 }] },
        { role: "user", content: "Can I book a cleaning?", words: [{ word: "Can", start: 4 }] },
      ],
    };
    renderClient();
    expect(await screen.findByText("Thanks for calling!")).toBeInTheDocument();
    expect(screen.getByText("Can I book a cleaning?")).toBeInTheDocument();
    expect(screen.getByText("AI assistant · 0:00")).toBeInTheDocument();
    expect(screen.getByText("Caller · 0:04")).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });
});
