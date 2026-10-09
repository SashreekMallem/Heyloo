import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    children,
    href,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/realtime/tenant-realtime-provider", () => ({
  useTenantRealtimeStatus: () => "connected",
}));

const enqueuePrint = vi.fn(async (_html: string) => "printed" as const);
vi.mock("@/lib/live/print", () => ({
  enqueuePrint: (html: string) => enqueuePrint(html),
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args), success: vi.fn() },
}));

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

interface Tables {
  orders: Record<string, unknown>[];
  customers: Record<string, unknown>[];
  bookings: Record<string, unknown>[];
  offerings: Record<string, unknown>[];
  call_logs: Record<string, unknown>[];
}

function orderRow(id: string, status: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    created_at: minutesAgo(4),
    status,
    fulfillment_type: "pickup",
    customer_id: "c1",
    items: [
      { name: "Margherita pizza", qty: 2, unit_price_cents: 1450, modifiers: ["Extra basil"] },
    ],
    allergies: [],
    special_instructions: null,
    delivery_address: null,
    address_verification: null,
    subtotal_cents: 2900,
    tax_cents: 239,
    tip_cents: 0,
    delivery_fee_cents: 0,
    total_cents: 3139,
    ...overrides,
  };
}

function freshTables(): Tables {
  return {
    orders: [
      orderRow("order-aaaa-0001", "received", {
        allergies: ["peanuts"],
        special_instructions: "Cut in squares",
      }),
      orderRow("order-bbbb-0002", "preparing", { customer_id: "c2", created_at: minutesAgo(20) }),
    ],
    customers: [
      { id: "c1", name: "Priya Natarajan", phone_e164: "+15125551000" },
      { id: "c2", name: "Marcus Webb", phone_e164: "+15125551001" },
    ],
    bookings: [
      {
        id: "booking-1",
        created_at: minutesAgo(30),
        start_at: hoursFromNow(2),
        status: "confirmed",
        customer_id: "c2",
        offering_id: "off-1",
        party_size: 4,
        notes: null,
        hold_expires_at: null,
      },
      {
        id: "booking-hold",
        created_at: minutesAgo(10),
        start_at: hoursFromNow(3),
        status: "scheduled",
        customer_id: "c1",
        offering_id: null,
        party_size: 2,
        notes: null,
        hold_expires_at: hoursFromNow(1),
      },
    ],
    offerings: [{ id: "off-1", name: "Dinner reservation" }],
    call_logs: [
      {
        id: "call-1",
        created_at: minutesAgo(12),
        caller_number: "+15125559999",
        message_text: "Please call me back about catering.",
        structured_booking_payload: {
          caller_name: "Grace Kim",
          callback_window: "after 3 PM",
        },
      },
    ],
  };
}

let tables: Tables = freshTables();
const eqCalls: [string, string, unknown][] = [];

function chain(table: keyof Tables) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "in", "gte", "lt", "order", "limit", "not", "neq"]) {
    obj[method] = vi.fn(() => obj);
  }
  obj["eq"] = vi.fn((col: string, val: unknown) => {
    eqCalls.push([table, col, val]);
    return obj;
  });
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve({
      data: tables[table],
      count: tables[table].length,
      error: null,
    }).then(resolve, reject);
  return obj;
}

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: {
    from: (table: keyof Tables) => chain(table),
  },
}));

import { LiveScreen } from "./live-screen";

function renderLive(props: Partial<{ vertical: string }> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <LiveScreen
        tenantId="t1"
        businessName="Golden Fork Bistro"
        vertical={props.vertical ?? "restaurant"}
        timeZone="America/Chicago"
      />
    </QueryClientProvider>,
  );
  return { client, ...utils };
}

/** The list item (feed card) inside `region` that shows `text`. */
async function listItemWith(region: HTMLElement, text: RegExp): Promise<HTMLElement> {
  await within(region).findByText(text);
  const item = within(region)
    .getAllByRole("listitem")
    .find((li) => within(li).queryByText(text) !== null);
  if (!item) throw new Error(`No list item shows ${text}`);
  return item;
}

async function start(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Start live screen" }));
}

beforeEach(() => {
  tables = freshTables();
  eqCalls.length = 0;
  enqueuePrint.mockClear();
  toastError.mockClear();
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A fake Web Audio context; each chime is two oscillator tones. */
function stubAudio() {
  let tones = 0;
  class FakeAudioContext {
    state = "running";
    currentTime = 0;
    destination = {};
    addEventListener = () => undefined;
    resume = async () => undefined;
    close = async () => undefined;
    createOscillator() {
      tones += 1;
      return {
        type: "",
        frequency: { setValueAtTime: () => undefined },
        connect: () => ({ connect: () => undefined }),
        start: () => undefined,
        stop: () => undefined,
      };
    }
    createGain() {
      return {
        gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined },
      };
    }
  }
  vi.stubGlobal("AudioContext", FakeAudioContext);
  return { tones: () => tones };
}

describe("LiveScreen (LIVE-1)", () => {
  it("opens behind a start button, then shows orders, bookings and messages", async () => {
    const user = userEvent.setup();
    renderLive();
    expect(screen.getByRole("heading", { name: "Live screen" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^Orders/ })).not.toBeInTheDocument();

    await start(user);

    expect(screen.getByRole("heading", { name: "Golden Fork Bistro" })).toBeInTheDocument();
    const newColumn = await screen.findByRole("region", { name: /^New/ });
    expect(within(newColumn).getByRole("heading", { name: "#AA0001" })).toBeInTheDocument();
    expect(within(newColumn).getByText("peanuts")).toBeInTheDocument();
    expect(within(newColumn).getByText("Allergy")).toBeInTheDocument();
    expect(within(newColumn).getByText("Cut in squares")).toBeInTheDocument();
    expect(within(newColumn).getByText("Margherita pizza")).toBeInTheDocument();
    expect(within(newColumn).getByText(/Priya Natarajan/)).toBeInTheDocument();
    expect(within(newColumn).getByText("4 min ago")).toBeInTheDocument();

    const inProgress = screen.getByRole("region", { name: /^In progress/ });
    expect(within(inProgress).getByRole("heading", { name: "#BB0002" })).toBeInTheDocument();

    const bookings = await screen.findByRole("region", { name: /^Bookings/ });
    expect(await within(bookings).findByText(/Dinner reservation/)).toBeInTheDocument();
    expect(within(bookings).getByText(/Party of 4/)).toBeInTheDocument();
    // An unpaid deposit hold isn't a booking yet.
    expect(within(bookings).queryByText(/Priya Natarajan/)).not.toBeInTheDocument();

    const messages = screen.getByRole("region", { name: /^Messages/ });
    expect(
      await within(messages).findByText("Please call me back about catering."),
    ).toBeInTheDocument();
    expect(within(messages).getByText(/Grace Kim/)).toBeInTheDocument();
    expect(within(messages).getByText("Best time to call back: after 3 PM")).toBeInTheDocument();

    // Every query is tenant-scoped and leaves test rows out.
    expect(eqCalls).toContainEqual(["orders", "tenant_id", "t1"]);
    expect(eqCalls).toContainEqual(["orders", "is_test", false]);
    expect(eqCalls).toContainEqual(["bookings", "is_test", false]);
    expect(eqCalls).toContainEqual(["call_logs", "is_test_call", false]);
    expect(eqCalls).toContainEqual(["customers", "tenant_id", "t1"]);
  });

  it("moves an order forward optimistically through PATCH /api/tenant/orders/[id]", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      // The server applies the change, so the follow-up refetch agrees.
      const { status } = JSON.parse(String(init?.body)) as { status: string };
      tables.orders = tables.orders.map((o) =>
        o["id"] === "order-aaaa-0001" ? { ...o, status } : o,
      );
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderLive();
    await start(user);

    await user.click(await screen.findByRole("button", { name: "Confirm order #AA0001" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tenant/orders/order-aaaa-0001",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "confirmed" }) }),
    );
    const inProgress = screen.getByRole("region", { name: /^In progress/ });
    expect(
      await within(inProgress).findByRole("button", { name: "Start order #AA0001" }),
    ).toBeInTheDocument();
  });

  it("rolls back and tells the user when the status update fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    const user = userEvent.setup();
    renderLive();
    await start(user);

    await user.click(await screen.findByRole("button", { name: "Confirm order #AA0001" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringContaining("#AA0001")),
    );
    const newColumn = screen.getByRole("region", { name: /^New/ });
    expect(
      await within(newColumn).findByRole("button", { name: "Confirm order #AA0001" }),
    ).toBeInTheDocument();
  });

  it("prints an 80 mm ticket for an order", async () => {
    const user = userEvent.setup();
    renderLive();
    await start(user);

    await user.click(await screen.findByRole("button", { name: "Print ticket for order #AA0001" }));

    expect(enqueuePrint).toHaveBeenCalledTimes(1);
    const html = enqueuePrint.mock.calls[0]?.[0] ?? "";
    expect(html).toContain("Golden Fork Bistro");
    expect(html).toContain("Allergy: peanuts");
    expect(html).toContain("size: 80mm auto");
  });

  it("detects a new order on refetch, announces it and auto-prints it (first load stays silent)", async () => {
    window.localStorage.setItem("heyloo.live.autoPrint", "1");
    const user = userEvent.setup();
    const { client } = renderLive();
    await start(user);
    await screen.findByRole("heading", { name: "#AA0001" });
    expect(enqueuePrint).not.toHaveBeenCalled();
    expect(screen.getByRole("switch", { name: "Auto-print new orders" })).toBeChecked();

    tables.orders = [...tables.orders, orderRow("order-cccc-0003", "received")];
    await client.invalidateQueries({ queryKey: ["tenant", "t1", "orders"] });

    expect(await screen.findByRole("heading", { name: "#CC0003" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("New order");
    await waitFor(() => expect(enqueuePrint).toHaveBeenCalledTimes(1));
    expect(enqueuePrint.mock.calls[0]?.[0]).toContain("#CC0003");
  });

  it("plays a sound check on start when nothing is waiting, and chimes when a new message arrives", async () => {
    // Nothing in "received": the start tap plays only the quiet sound check.
    tables.orders = tables.orders.filter((o) => o["status"] !== "received");
    const audio = stubAudio();
    const user = userEvent.setup();
    const { client } = renderLive();
    await screen.findByRole("button", { name: "Start live screen" });
    await waitFor(() => expect(eqCalls).toContainEqual(["call_logs", "is_test_call", false]));
    await start(user);
    await screen.findByText("Please call me back about catering.");
    // Two tones = one chime: the sound check. The first load never chimes.
    expect(audio.tones()).toBe(2);

    tables.call_logs = [
      {
        id: "call-2",
        created_at: minutesAgo(0),
        caller_number: "+15125558888",
        message_text: "Is the patio open tonight?",
        structured_booking_payload: {},
      },
      ...tables.call_logs,
    ];
    await client.invalidateQueries({ queryKey: ["tenant", "t1", "call_logs"] });

    await screen.findByText("Is the patio open tonight?");
    await waitFor(() => expect(audio.tones()).toBe(4));
    expect(screen.getByRole("status")).toHaveTextContent("New message");
  });

  it("rings for an order already waiting when the screen loads, every 10 s until it is confirmed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const { status } = JSON.parse(String(init?.body)) as { status: string };
        tables.orders = tables.orders.map((o) =>
          o["id"] === "order-aaaa-0001" ? { ...o, status } : o,
        );
        return new Response("{}", { status: 200 });
      }),
    );
    const audio = stubAudio();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderLive();
    // Data loads behind the overlay (e.g. after a reload), then Start is tapped.
    await waitFor(() => expect(eqCalls).toContainEqual(["orders", "is_test", false]));
    await start(user);
    await screen.findByRole("heading", { name: "#AA0001" });
    // The alert itself rings at once (no separate sound check on top).
    await waitFor(() => expect(audio.tones()).toBe(2));

    await vi.advanceTimersByTimeAsync(10_000);
    expect(audio.tones()).toBe(4);

    await user.click(screen.getByRole("button", { name: "Confirm order #AA0001" }));
    const inProgress = screen.getByRole("region", { name: /^In progress/ });
    await within(inProgress).findByRole("button", { name: "Start order #AA0001" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(audio.tones()).toBe(4);
  });

  it("does not ring for an old booking that enters today's list at midnight", async () => {
    tables.orders = [];
    const audio = stubAudio();
    const user = userEvent.setup();
    const { client } = renderLive();
    await start(user);
    const bookings = await screen.findByRole("region", { name: /^Bookings/ });
    await within(bookings).findByText(/Dinner reservation/);
    expect(audio.tones()).toBe(2); // the sound check

    // Past tenant midnight the "today" window moves on, and the refetch now
    // returns a booking for the new day that was made three days ago.
    tables.customers = [...tables.customers, { id: "c3", name: "Ana Ortiz", phone_e164: null }];
    tables.bookings = [
      ...tables.bookings,
      {
        id: "booking-old",
        created_at: minutesAgo(3 * 24 * 60),
        start_at: hoursFromNow(5),
        status: "confirmed",
        customer_id: "c3",
        offering_id: null,
        party_size: 2,
        notes: null,
        hold_expires_at: null,
      },
    ];
    await client.invalidateQueries({ queryKey: ["tenant", "t1", "bookings"] });
    const oldCard = await listItemWith(bookings, /Ana Ortiz/);
    expect(within(oldCard).queryByText("New")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).not.toHaveTextContent("New booking");
    expect(audio.tones()).toBe(2);

    // A booking actually made just now still rings, and "Got it" is there to stop it.
    tables.bookings = [
      ...tables.bookings,
      {
        id: "booking-new",
        created_at: minutesAgo(0),
        start_at: hoursFromNow(6),
        status: "confirmed",
        customer_id: "c1",
        offering_id: null,
        party_size: 3,
        notes: null,
        hold_expires_at: null,
      },
    ];
    await client.invalidateQueries({ queryKey: ["tenant", "t1", "bookings"] });
    const newCard = await listItemWith(bookings, /Party of 3/);
    expect(screen.getByRole("status")).toHaveTextContent("New booking");
    await waitFor(() => expect(audio.tones()).toBe(4));
    expect(within(newCard).getByRole("button", { name: "Got it" })).toBeInTheDocument();
  });

  it("turning sound back on while something is waiting plays one chime, not two", async () => {
    const audio = stubAudio();
    const user = userEvent.setup();
    renderLive();
    await waitFor(() => expect(eqCalls).toContainEqual(["orders", "is_test", false]));
    await start(user);
    await screen.findByRole("heading", { name: "#AA0001" });
    await waitFor(() => expect(audio.tones()).toBe(2));

    const sound = screen.getByRole("button", { name: "Sound" });
    await user.click(sound);
    expect(sound).toHaveAttribute("aria-pressed", "false");
    await user.click(sound);
    expect(sound).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(audio.tones()).toBe(4));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(audio.tones()).toBe(4);
  });

  it("highlights a new booking until it is acknowledged on this device", async () => {
    const user = userEvent.setup();
    renderLive();
    await start(user);
    const bookings = await screen.findByRole("region", { name: /^Bookings/ });
    await within(bookings).findByText(/Dinner reservation/);
    expect(within(bookings).getByText("New")).toBeInTheDocument();

    await user.click(within(bookings).getByRole("button", { name: "Got it" }));

    expect(within(bookings).queryByText("New")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("heyloo.live.t1.acks")).toContain("booking:booking-1");
  });

  it("puts bookings first and hides Orders for a non-restaurant with no recent orders", async () => {
    tables.orders = [];
    const user = userEvent.setup();
    renderLive({ vertical: "dental" });
    await start(user);

    await screen.findByRole("region", { name: /^Bookings/ });
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: /^Orders/ })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("switch", { name: "Auto-print new orders" })).not.toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toMatch(/^Bookings/);
  });

  it("has an Exit link back to the dashboard and a sound toggle", async () => {
    const user = userEvent.setup();
    renderLive();
    await start(user);
    expect(screen.getByRole("link", { name: "Exit" })).toHaveAttribute("href", "/dashboard");
    const sound = screen.getByRole("button", { name: "Sound" });
    expect(sound).toHaveAttribute("aria-pressed", "true");
    await user.click(sound);
    expect(sound).toHaveAttribute("aria-pressed", "false");
    expect(window.localStorage.getItem("heyloo.live.sound")).toBe("0");
  });
});
