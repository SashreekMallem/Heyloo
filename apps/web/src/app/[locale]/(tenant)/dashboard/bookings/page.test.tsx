import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = [string, unknown[]];
interface Recorded {
  table: string;
  calls: Call[];
}
const chains: Recorded[] = [];

let bookingsRows: Record<string, unknown>[] = [];
let bookingsCount: number | null = null;
let bookingSingle: Record<string, unknown> | null = null;
let slotRows: { id: string; slot_range: string }[] = [];

function resultFor(rec: Recorded, single: boolean) {
  switch (rec.table) {
    case "tenants":
      return { data: { timezone: "America/New_York" }, error: null };
    case "bookings": {
      const cols = String(rec.calls.find(([m]) => m === "select")?.[1][0] ?? "");
      if (single) {
        if (cols.startsWith("resource_id")) {
          return {
            data: {
              resource_id: "r1",
              customer_id: null,
              party_size: null,
              structured_payload: {},
              quoted_rate_cents: null,
              identity_verified_by: null,
            },
            error: null,
          };
        }
        return { data: bookingSingle, error: null };
      }
      return { data: bookingsRows, count: bookingsCount ?? bookingsRows.length, error: null };
    }
    case "availability_slots":
      return { data: slotRows, error: null };
    case "customers":
      return single
        ? { data: { name: "Jamie Cruz", phone_e164: null, consent: null }, error: null }
        : { data: [{ id: "c1", name: "Jamie Cruz" }], error: null };
    default:
      return { data: single ? null : [], error: null };
  }
}

function chain(table: string) {
  const rec: Recorded = { table, calls: [] };
  chains.push(rec);
  const obj: Record<string, unknown> = {};
  let single = false;
  for (const m of [
    "select",
    "eq",
    "in",
    "gte",
    "lt",
    "order",
    "limit",
    "range",
    "rangeGte",
    "maybeSingle",
  ]) {
    obj[m] = vi.fn((...args: unknown[]) => {
      rec.calls.push([m, args]);
      if (m === "maybeSingle") single = true;
      return obj;
    });
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(resultFor(rec, single)).then(resolve, reject);
  return obj;
}

let searchParams = new URLSearchParams();
const routerReplace = vi.fn();

vi.mock("next/navigation", () => ({ useSearchParams: () => searchParams }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
}));
vi.mock("@/lib/tenant/tenant-context", () => ({ useCurrentTenantId: () => "t1" }));
vi.mock("@/lib/messaging/use-texting-on", () => ({ useTextingOn: () => true }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: { from: vi.fn((table: string) => chain(table)) },
}));

import BookingsPage, { groupSlotsByDay } from "./page";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BookingsPage />
    </QueryClientProvider>,
  );
}

const listChains = () =>
  chains.filter(
    (c) =>
      c.table === "bookings" &&
      c.calls.some(([m, a]) => m === "select" && String(a[0]).startsWith("id, start_at")) &&
      c.calls.some(([m]) => m === "order") &&
      !c.calls.some(([m]) => m === "maybeSingle"),
  );
const arg = (rec: Recorded | undefined, method: string) =>
  rec?.calls.find(([m]) => m === method)?.[1];

const row = (over: Record<string, unknown>) => ({
  id: "b1",
  start_at: "2026-10-01T14:00:00Z",
  status: "scheduled",
  customer_id: "c1",
  ...over,
});

beforeEach(() => {
  chains.length = 0;
  bookingsRows = [row({})];
  bookingsCount = null;
  bookingSingle = null;
  slotRows = [];
  searchParams = new URLSearchParams();
  routerReplace.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  // 01:30 UTC Sep 30 = evening of Sep 29 in New York.
  vi.setSystemTime(new Date("2026-09-30T01:30:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("BookingsPage list window (QA-1 F-08)", () => {
  it("loads upcoming bookings from the tenant-local start of today, soonest first — not the oldest 200", async () => {
    renderPage();
    await screen.findByText("Jamie Cruz");
    const list = listChains()[0];
    expect(arg(list, "gte")).toEqual(["start_at", "2026-09-29T04:00:00.000Z"]);
    expect(arg(list, "order")).toEqual(["start_at", { ascending: true }]);
    expect(arg(list, "lt")).toBeUndefined();
  });

  it("has a separate paginated Past view: before today, newest first, 25 per page", async () => {
    const user = userEvent.setup();
    bookingsCount = 60;
    renderPage();
    await screen.findByText("Jamie Cruz");
    await user.click(screen.getByRole("radio", { name: "Past bookings" }));
    await waitFor(() => expect(listChains().some((c) => arg(c, "lt"))).toBe(true));
    const past = listChains().find((c) => arg(c, "lt"));
    expect(arg(past, "lt")).toEqual(["start_at", "2026-09-29T04:00:00.000Z"]);
    expect(arg(past, "order")).toEqual(["start_at", { ascending: false }]);
    expect(arg(past, "range")).toEqual([0, 24]);
    expect(await screen.findByText("Page 1 of 3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Older" }));
    await waitFor(() =>
      expect(listChains().some((c) => JSON.stringify(arg(c, "range")) === "[25,49]")).toBe(true),
    );
  });

  it("fetches the calendar by the visible month grid and always renders the grid, even when empty", async () => {
    const user = userEvent.setup();
    bookingsRows = [];
    renderPage();
    await screen.findByText("No upcoming bookings");
    await user.click(screen.getByRole("radio", { name: "Calendar view" }));
    expect(await screen.findByRole("button", { name: "Next month" })).toBeInTheDocument();
    await waitFor(() => expect(listChains().some((c) => arg(c, "gte") && arg(c, "lt"))).toBe(true));
    const cal = listChains().find((c) => arg(c, "gte") && arg(c, "lt"));
    // September 2026 grid: starts Sun Aug 30, 42 days -> exclusive end Oct 11 (browser-local dates).
    const gte = new Date((arg(cal, "gte") as string[])[1] as string);
    const lt = new Date((arg(cal, "lt") as string[])[1] as string);
    expect(lt.getTime() - gte.getTime()).toBeGreaterThanOrEqual(41 * 86_400_000);
    expect(lt.getTime() - gte.getTime()).toBeLessThanOrEqual(43 * 86_400_000);

    await user.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() =>
      expect(listChains().filter((c) => arg(c, "gte") && arg(c, "lt")).length).toBe(2),
    );
  });
});

describe("BookingsPage reschedule (QA-1 F-07 / F-20)", () => {
  it("only offers slots from now on and groups them by day in one phone column", async () => {
    const user = userEvent.setup();
    slotRows = [
      { id: "s1", slot_range: '["2026-10-01 14:00:00+00","2026-10-01 14:30:00+00")' },
      { id: "s2", slot_range: '["2026-10-01 15:00:00+00","2026-10-01 15:30:00+00")' },
      { id: "s3", slot_range: '["2026-10-02 14:00:00+00","2026-10-02 14:30:00+00")' },
    ];
    bookingSingle = null;
    renderPage();
    await user.click(await screen.findByText("Jamie Cruz"));
    await user.click(await screen.findByRole("button", { name: "Reschedule" }));

    await waitFor(() => expect(chains.some((c) => c.table === "availability_slots")).toBe(true));
    const slots = chains.find((c) => c.table === "availability_slots");
    expect(arg(slots, "rangeGte")).toEqual(["slot_range", "[2026-09-30T01:30:00.000Z,)"]);
    expect(arg(slots, "eq")).toBeDefined();

    // 2 day groups: Oct 1 (2 slots) and Oct 2 (1 slot)
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(within(dialog).getAllByRole("button", { name: /\d:\d\d/ })).toHaveLength(3),
    );
    const groups = within(dialog).getAllByText(/^(Wed|Thu|Fri), /);
    expect(groups).toHaveLength(2);
    // buttons wrap instead of clipping and live in a single-column grid on phones
    const first = within(dialog).getAllByRole("button", { name: /\d:\d\d/ })[0] as HTMLElement;
    expect(first.className).toContain("whitespace-normal");
    expect(first.parentElement?.className).toContain("grid-cols-1");
  });

  it("does not offer Confirm / Reschedule / Cancel on a completed booking", async () => {
    const user = userEvent.setup();
    bookingsRows = [row({ status: "completed" })];
    renderPage();
    await user.click(await screen.findByText("Jamie Cruz"));
    expect(
      await screen.findByText(/can no longer be confirmed, rescheduled or cancelled/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reschedule" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel booking" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
  });

  it("offers Confirm only while scheduled; a confirmed booking can be rescheduled/cancelled but not re-confirmed", async () => {
    const user = userEvent.setup();
    bookingsRows = [row({ status: "confirmed" })];
    renderPage();
    await user.click(await screen.findByText("Jamie Cruz"));
    expect(await screen.findByRole("button", { name: "Reschedule" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel booking" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
  });
});

describe("BookingsPage deep link (?booking=<id>)", () => {
  it("opens that booking's sheet even when it is outside the list window", async () => {
    bookingsRows = [];
    searchParams = new URLSearchParams("booking=b-old");
    bookingSingle = row({ id: "b-old", start_at: "2026-08-01T14:00:00Z", status: "completed" });
    renderPage();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Jamie Cruz")).toBeInTheDocument();
  });

  it("clears the param when the sheet is closed", async () => {
    const user = userEvent.setup();
    searchParams = new URLSearchParams("booking=b1");
    bookingSingle = row({});
    renderPage();
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith("/dashboard/bookings"));
  });
});

describe("groupSlotsByDay", () => {
  it("keeps slot order and groups by calendar day", () => {
    const groups = groupSlotsByDay([
      { id: "a", start: "2026-10-01T14:00:00Z" },
      { id: "b", start: "2026-10-01T15:00:00Z" },
      { id: "c", start: "2026-10-02T14:00:00Z" },
    ]);
    expect(groups.map((g) => g.slots.map((s) => s.id))).toEqual([["a", "b"], ["c"]]);
  });
});
