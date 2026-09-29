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

  it("renders failed / queued / pending-verification system SMS as muted events, not 'You' bubbles that say 'sent' (QA-1 F-03)", async () => {
    tables = {
      customers: { data: { name: null, sms_opt_out: false }, error: null },
      text_conversations: { data: null, error: null },
      messages_inbound: { data: [], error: null },
      messages_outbound: {
        data: [
          {
            id: "o1",
            template_key: "booking_confirmation",
            payload: {},
            status: "failed",
            created_at: "2026-01-01T10:00:00Z",
          },
          {
            id: "o2",
            template_key: "booking_cancelled",
            payload: {},
            status: "pending_verification",
            created_at: "2026-01-01T11:00:00Z",
          },
          {
            id: "o3",
            template_key: "owner_reply",
            payload: { body: "See you at 3" },
            status: "failed",
            created_at: "2026-01-01T12:00:00Z",
          },
          {
            id: "o4",
            template_key: "payment_link",
            payload: {},
            status: "delivered",
            created_at: "2026-01-01T13:00:00Z",
          },
        ],
        error: null,
      },
    };
    renderClient("+15551234567");
    expect(await screen.findByText(/Booking confirmation - not sent/)).toBeInTheDocument();
    expect(
      screen.getByText(/Cancellation notice - not sent - texting is pending verification/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Booking confirmation sent/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Cancellation notice sent/)).not.toBeInTheDocument();
    // Only the real owner reply is a "You" bubble, flagged as undelivered.
    expect(screen.getAllByText("You")).toHaveLength(1);
    expect(screen.getByText("See you at 3")).toBeInTheDocument();
    expect(screen.getByText("not sent - delivery failed")).toBeInTheDocument();
    // A delivered system template is a muted event too.
    expect(screen.getByText(/Payment link sent/)).toBeInTheDocument();
    expect(screen.getAllByTestId("system-event")).toHaveLength(3);
  });

  it("does not save a transcript row or a phantom 'You' message when the SMS send fails (QA-1 F-11)", async () => {
    tables = {
      customers: { data: { name: null, sms_opt_out: false }, error: null },
      text_conversations: {
        data: { id: "conv1", channel: "sms", status: "open", customer_id: null },
        error: null,
      },
      text_conversation_messages: { data: [], error: null },
    };
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: "send_failed" }), { status: 500 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderClient("+15551234567");
    await user.type(await screen.findByPlaceholderText("Type a reply…"), "On my way");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(insertSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("saves the transcript row after a successful send and pauses the AI (status human) on the first reply (QA-1 F-11)", async () => {
    tables = {
      customers: { data: { name: null, sms_opt_out: false }, error: null },
      text_conversations: {
        data: { id: "conv1", channel: "sms", status: "open", customer_id: null },
        error: null,
      },
      text_conversation_messages: { data: [], error: null },
    };
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderClient("+15551234567");
    await user.type(await screen.findByPlaceholderText("Type a reply…"), "On my way");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(insertSpy).toHaveBeenCalledWith(
        expect.objectContaining({ conversation_id: "conv1", author: "human", body: "On my way" }),
      ),
    );
    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith({ status: "human" }));
  });

  it("shows an empty state with no composer for a non-E.164 thread URL (QA-1 F-22)", async () => {
    renderClient("abc");
    expect(await screen.findByText("That isn't a valid phone number")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Type a reply…")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
  });

  it("shows an empty state (no composer) for a valid number with no conversation, history or customer (QA-1 F-22)", async () => {
    tables = {
      customers: { data: null, error: null },
      text_conversations: { data: null, error: null },
      messages_inbound: { data: [], error: null },
      messages_outbound: { data: [], error: null },
    };
    renderClient("+15550001111");
    expect(await screen.findByText("No messages with this number yet")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Type a reply…")).not.toBeInTheDocument();
  });

  it("still offers the composer for an existing customer with no history yet", async () => {
    tables = {
      customers: { data: { name: "Jamie", sms_opt_out: false }, error: null },
      text_conversations: { data: null, error: null },
      messages_inbound: { data: [], error: null },
      messages_outbound: { data: [], error: null },
    };
    renderClient("+15550001111");
    expect(await screen.findByPlaceholderText("Type a reply…")).toBeInTheDocument();
  });
});
