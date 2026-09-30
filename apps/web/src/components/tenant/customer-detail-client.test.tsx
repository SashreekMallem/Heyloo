import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import {
  CustomerDetailClient,
  type CustomerDetailData,
  parseCustomerNotes,
} from "./customer-detail-client";

function customer(overrides: Partial<CustomerDetailData> = {}): CustomerDetailData {
  return {
    id: "c1",
    name: "Jamie Cruz",
    phone: "+15552019010",
    email: null,
    segment: "new",
    lifetimeValueCents: 0,
    metadata: {},
    consent: { sms: true },
    calls: [],
    bookings: [],
    ...overrides,
  } as CustomerDetailData;
}

beforeEach(() => {
  refresh.mockClear();
  vi.unstubAllGlobals();
});

describe("parseCustomerNotes (QA-1 F-05)", () => {
  it("lists notes newest first and tolerates string / alternate-key legacy entries", () => {
    const notes = parseCustomerNotes({
      notes: [
        { body: "older", created_at: "2026-09-01T10:00:00Z", author_id: "u1" },
        "pre-existing note",
        { text: "legacy text", created_at: "2026-09-02T10:00:00Z" },
        { body: "newest", created_at: "2026-09-03T10:00:00Z", author_id: "u2" },
        { body: "   " },
        42,
      ],
    });
    expect(notes.map((n) => n.body)).toEqual([
      "newest",
      "legacy text",
      "older",
      "pre-existing note",
    ]);
  });

  it("handles a single string and missing notes", () => {
    expect(parseCustomerNotes({ notes: "just one" }).map((n) => n.body)).toEqual(["just one"]);
    expect(parseCustomerNotes({})).toEqual([]);
  });
});

describe("CustomerDetailClient notes (QA-1 F-05)", () => {
  it("displays existing notes with date and author", () => {
    render(
      <CustomerDetailClient
        currentUserId="u1"
        customer={customer({
          metadata: {
            notes: [
              { body: "pre-existing note", created_at: "2026-09-01T10:00:00Z", author_id: "u1" },
              { body: "call back Friday", created_at: "2026-09-02T10:00:00Z", author_id: "u9" },
            ],
          },
        })}
      />,
    );
    const list = screen.getByRole("list", { name: "Customer notes" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    // newest first
    expect(items[0]).toHaveTextContent("call back Friday");
    expect(items[0]).toHaveTextContent("Team member");
    expect(items[1]).toHaveTextContent("pre-existing note");
    expect(items[1]).toHaveTextContent("You");
  });

  it("shows an empty-notes hint when there are none", () => {
    render(<CustomerDetailClient customer={customer()} />);
    expect(screen.getByText("No notes yet.")).toBeInTheDocument();
  });

  it("refreshes the page after a note is saved so it appears in the list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    const user = userEvent.setup();
    render(<CustomerDetailClient customer={customer()} />);
    await user.type(screen.getByPlaceholderText(/Add a note/), "Prefers mornings");
    await user.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("does not refresh when saving fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    const user = userEvent.setup();
    render(<CustomerDetailClient customer={customer()} />);
    await user.type(screen.getByPlaceholderText(/Add a note/), "x");
    await user.click(screen.getByRole("button", { name: "Save note" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("CustomerDetailClient SMS opt-out (QA-1 F-09)", () => {
  it("shows 'Opted out' instead of 'Consent on file' and removes the message link", () => {
    render(
      <CustomerDetailClient customer={customer({ smsOptOut: true, consent: { sms: true } })} />,
    );
    expect(screen.getByText("Opted out")).toBeInTheDocument();
    expect(screen.queryByText("Consent on file")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Message this customer" })).not.toBeInTheDocument();
    expect(screen.getByText(/Opted out of texts/)).toBeInTheDocument();
  });

  it("keeps the consent badge and message link for an opted-in customer", () => {
    render(<CustomerDetailClient customer={customer({ smsOptOut: false })} />);
    expect(screen.getByText("Consent on file")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Message this customer" })).toBeInTheDocument();
  });
});
