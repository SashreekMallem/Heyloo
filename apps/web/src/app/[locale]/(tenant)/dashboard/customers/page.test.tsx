import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = [string, unknown[]];
const chains: { calls: Call[]; result: () => unknown }[] = [];
let resultFor: (calls: Call[]) => unknown = () => ({ data: [], error: null });

function chain() {
  const calls: Call[] = [];
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "ilike", "or"]) {
    obj[method] = vi.fn((...args: unknown[]) => {
      calls.push([method, args]);
      return obj;
    });
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(resultFor(calls)).then(resolve, reject);
  chains.push({ calls, result: () => resultFor(calls) });
  return obj;
}

vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/tenant/tenant-context", () => ({ useCurrentTenantId: () => "t1" }));
vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: { from: vi.fn(() => chain()) },
}));

import CustomersPage from "./page";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CustomersPage />
    </QueryClientProvider>,
  );
}

const row = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  name: "Drew Malone",
  phone_e164: "+15552019010",
  segment: "new",
  lifetime_value_cents: 0,
  consent: { sms: true },
  sms_opt_out: false,
  last_seen_at: "2026-09-01T00:00:00Z",
  ...over,
});

const has = (method: string, ...args: unknown[]) =>
  chains.some((c) => c.calls.some(([m, a]) => m === method && args.every((x, i) => a[i] === x)));

beforeEach(() => {
  chains.length = 0;
  resultFor = () => ({ data: [row()], error: null });
});

describe("CustomersPage search (QA-1 F-10 / SEC-15)", () => {
  it("never builds a raw .or() filter: a comma in the term is a plain ilike value", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByText("Drew Malone");
    await user.type(screen.getByPlaceholderText("Search name or phone"), "Malone, Drew");
    await waitFor(() => expect(has("ilike", "name", "%Malone, Drew%")).toBe(true));
    expect(chains.some((c) => c.calls.some(([m]) => m === "or"))).toBe(false);
    // no digits in the term -> no phone filter at all
    expect(has("ilike", "phone_e164")).toBe(false);
  });

  it("matches a phone typed in its displayed format against the E.164 digits", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByText("Drew Malone");
    await user.type(screen.getByPlaceholderText("Search name or phone"), "(555) 201-9010");
    await waitFor(() => expect(has("ilike", "phone_e164", "%5552019010%")).toBe(true));
  });

  it("escapes '%' so it does not match every customer", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByText("Drew Malone");
    await user.type(screen.getByPlaceholderText("Search name or phone"), "%");
    await waitFor(() => expect(has("ilike", "name", "%\\%%")).toBe(true));
  });

  it("shows a distinct 'no customers match' message for a search with no results", async () => {
    resultFor = (calls) =>
      calls.some(([m]) => m === "ilike")
        ? { data: [], error: null }
        : { data: [row()], error: null };
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByText("Drew Malone");
    await user.type(screen.getByPlaceholderText("Search name or phone"), "zzz");
    expect(await screen.findByText('No customers match "zzz"')).toBeInTheDocument();
    expect(screen.queryByText("No customers yet")).not.toBeInTheDocument();
  });

  it("shows 'No customers yet' only when there is no search and no data", async () => {
    resultFor = () => ({ data: [], error: null });
    renderPage();
    expect(await screen.findByText("No customers yet")).toBeInTheDocument();
  });

  it("surfaces a query error instead of reading as 'No customers yet'", async () => {
    resultFor = () => ({ data: null, error: { message: "boom" } });
    renderPage();
    expect(await screen.findByText(/boom|went wrong|try again/i)).toBeInTheDocument();
    expect(screen.queryByText("No customers yet")).not.toBeInTheDocument();
  });
});

describe("CustomersPage consent badge (QA-1 F-09)", () => {
  it("shows 'Opted out' rather than consent for a customer who texted STOP", async () => {
    resultFor = () => ({
      data: [row({ sms_opt_out: true, consent: { sms: true } })],
      error: null,
    });
    renderPage();
    expect((await screen.findAllByText("Opted out")).length).toBeGreaterThan(0);
    expect(screen.queryByText("On file")).not.toBeInTheDocument();
  });

  it("still shows 'On file' for an opted-in customer with consent", async () => {
    renderPage();
    expect((await screen.findAllByText("On file")).length).toBeGreaterThan(0);
  });
});
