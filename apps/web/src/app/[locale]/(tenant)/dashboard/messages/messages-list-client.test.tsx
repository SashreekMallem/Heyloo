import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit"]) {
    obj[method] = vi.fn(() => obj);
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

let tables: Record<string, unknown> = {};

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: {
    from: vi.fn((table: string) => chain(tables[table] ?? { data: [], error: null })),
  },
}));

import { MessagesListClient } from "./messages-list-client";

function renderClient() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MessagesListClient tenantId="t1" />
    </QueryClientProvider>,
  );
}

describe("MessagesListClient", () => {
  afterEach(() => {
    tables = {};
  });

  it("attaches a status badge to an SMS thread that has a matching text_conversations row", async () => {
    tables = {
      messages_inbound: {
        data: [
          {
            from_e164: "+15551234567",
            body: "Hi there",
            handled: true,
            created_at: "2026-01-01T10:00:00Z",
          },
        ],
        error: null,
      },
      messages_outbound: { data: [], error: null },
      text_conversations: {
        data: [
          {
            id: "conv1",
            channel: "sms",
            phone_e164: "+15551234567",
            customer_id: null,
            status: "human",
            recent_turns: [],
            updated_at: "2026-01-01T10:05:00Z",
          },
        ],
        error: null,
      },
      customers: { data: [], error: null },
    };
    renderClient();
    expect(await screen.findByText("Hi there")).toBeInTheDocument();
    expect(screen.getByText("You're replying")).toBeInTheDocument();
  });

  it("surfaces a web-chat-only conversation (no phone at all) as its own row", async () => {
    tables = {
      messages_inbound: { data: [], error: null },
      messages_outbound: { data: [], error: null },
      text_conversations: {
        data: [
          {
            id: "conv-wc-1",
            channel: "web_chat",
            phone_e164: null,
            customer_id: null,
            status: "open",
            recent_turns: [
              { role: "user", text: "Do you have delivery?", at: "2026-01-01T10:00:00Z" },
            ],
            updated_at: "2026-01-01T10:00:00Z",
          },
        ],
        error: null,
      },
      customers: { data: [], error: null },
    };
    renderClient();
    expect(await screen.findByText("Web visitor")).toBeInTheDocument();
    expect(screen.getByText("Do you have delivery?")).toBeInTheDocument();
  });

  it("updates lastAt/preview from a text_conversations row newer than the matching SMS row", async () => {
    tables = {
      messages_inbound: {
        data: [
          {
            from_e164: "+15551234567",
            body: "Hi there",
            handled: true,
            created_at: "2026-01-01T10:00:00Z",
          },
        ],
        error: null,
      },
      messages_outbound: { data: [], error: null },
      text_conversations: {
        data: [
          {
            id: "conv1",
            channel: "sms",
            phone_e164: "+15551234567",
            customer_id: null,
            status: "open",
            // Newer than messages_inbound's row above (e.g. an agent-only
            // STOP/HELP/YES reply recorded solely in recent_turns) — the
            // list must surface this as the thread's latest preview
            // instead of leaving the stale "Hi there" preview in place.
            recent_turns: [
              { role: "assistant", text: "You're all set for Tuesday", at: "2026-01-01T10:10:00Z" },
            ],
            updated_at: "2026-01-01T10:10:00Z",
          },
        ],
        error: null,
      },
      customers: { data: [], error: null },
    };
    renderClient();
    expect(await screen.findByText("You're all set for Tuesday")).toBeInTheDocument();
    expect(screen.queryByText("Hi there")).not.toBeInTheDocument();
  });

  it("shows the empty state with no threads at all", async () => {
    tables = {
      messages_inbound: { data: [], error: null },
      messages_outbound: { data: [], error: null },
      text_conversations: { data: [], error: null },
      customers: { data: [], error: null },
    };
    renderClient();
    expect(await screen.findByText("No messages yet")).toBeInTheDocument();
  });
});
