import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "maybeSingle", "insert", "update"]) {
    obj[method] = vi.fn(() => obj);
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

let tables: Record<string, unknown> = {};
const insertSpy = vi.fn();
const updateSpy = vi.fn();
const fetchSpy = vi.fn();

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: {
    from: vi.fn((table: string) => {
      if (table === "text_conversation_messages") {
        const c = chain(tables[table] ?? { data: [], error: null });
        (c as { insert: unknown }).insert = (row: unknown) => {
          insertSpy(row);
          return chain({ data: null, error: null });
        };
        return c;
      }
      if (table === "text_conversations") {
        const c = chain(tables[table] ?? { data: null, error: null });
        (c as { update: unknown }).update = (patch: unknown) => {
          updateSpy(patch);
          return chain({ data: null, error: null });
        };
        return c;
      }
      return chain(tables[table] ?? { data: null, error: null });
    }),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { MessageThreadClient } from "./message-thread-client";

function renderClient(phone: string) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MessageThreadClient tenantId="t1" phone={phone} />
    </QueryClientProvider>,
  );
}

describe("MessageThreadClient", () => {
  afterEach(() => {
    insertSpy.mockClear();
    updateSpy.mockClear();
    fetchSpy.mockClear();
    vi.unstubAllGlobals();
    tables = {};
  });

  it("falls back to the plain legacy view when no text_conversations row exists", async () => {
    tables = {
      customers: { data: { name: null, sms_opt_out: false }, error: null },
      text_conversations: { data: null, error: null },
      messages_inbound: {
        data: [{ id: "in1", body: "Hi, are you open?", created_at: "2026-01-01T10:00:00Z" }],
        error: null,
      },
      messages_outbound: { data: [], error: null },
    };
    renderClient("+15551234567");
    expect(await screen.findByText("Hi, are you open?")).toBeInTheDocument();
    expect(screen.queryByText(/Take over/)).not.toBeInTheDocument();
    expect(screen.queryByText("AI")).not.toBeInTheDocument();
  });

  it("shows the author-tagged transcript and Take over control when a conversation exists", async () => {
    tables = {
      customers: { data: { name: "Jamie", sms_opt_out: false }, error: null },
      text_conversations: {
        data: { id: "conv1", channel: "sms", status: "open", customer_id: null },
        error: null,
      },
      text_conversation_messages: {
        data: [
          {
            id: "m1",
            author: "customer",
            body: "Can I book Friday?",
            created_at: "2026-01-01T10:00:00Z",
          },
          { id: "m2", author: "ai", body: "Sure, what time?", created_at: "2026-01-01T10:01:00Z" },
        ],
        error: null,
      },
    };
    renderClient("+15551234567");

    expect(await screen.findByText("Can I book Friday?")).toBeInTheDocument();
    expect(screen.getByText("Sure, what time?")).toBeInTheDocument();
    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.getByText("AI is replying")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take over" })).toBeInTheDocument();
  });

  it("takes over the conversation and hands it back", async () => {
    tables = {
      customers: { data: { name: null, sms_opt_out: false }, error: null },
      text_conversations: {
        data: { id: "conv1", channel: "sms", status: "open", customer_id: null },
        error: null,
      },
      text_conversation_messages: { data: [], error: null },
    };
    const user = userEvent.setup();
    renderClient("+15551234567");

    await user.click(await screen.findByRole("button", { name: "Take over" }));
    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith({ status: "human" }));
  });

  it("sends a human reply into a web-chat conversation without calling the SMS route", async () => {
    tables = {
      text_conversations: {
        data: { id: "conv1", channel: "web_chat", status: "human", customer_id: null },
        error: null,
      },
      text_conversation_messages: { data: [], error: null },
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderClient("wc:conv1");

    await screen.findByText("You're replying");
    await user.type(screen.getByPlaceholderText("Type a reply…"), "We can fit you in at 3pm");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(insertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          conversation_id: "conv1",
          author: "human",
          body: "We can fit you in at 3pm",
        }),
      );
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("disables replies for an opted-out SMS customer", async () => {
    tables = {
      customers: { data: { name: null, sms_opt_out: true }, error: null },
      text_conversations: { data: null, error: null },
      messages_inbound: { data: [], error: null },
      messages_outbound: { data: [], error: null },
    };
    renderClient("+15551234567");
    expect(
      await screen.findByText(/opted out of texts — replies are disabled/),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Type a reply…")).not.toBeInTheDocument();
  });
});
