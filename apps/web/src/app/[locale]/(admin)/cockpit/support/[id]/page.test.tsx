import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess } }));

// Radix's Select measures its trigger; jsdom has no ResizeObserver.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { default: AdminSupportTicketPage } = await import("./page");

// `use(params)` needs a stable promise (a fresh one per render suspends forever).
const PARAMS = Promise.resolve({ id: "s1" });

const TICKET = {
  ticket: {
    id: "s1",
    tenant_name: "Acme",
    tenant_vertical: "dental",
    subject: "Change my hours",
    body: "Please update our Saturday hours",
    status: "open",
    priority: "medium",
    created_at: "2026-09-29T09:00:00Z",
  },
  notes: [
    {
      id: "n1",
      body: "Sure, which hours?",
      created_at: "2026-09-29T09:30:00Z",
      author_id: "admin1",
      author_role: "admin",
      visible_to_tenant: true,
    },
    {
      id: "n2",
      body: "They asked twice already",
      created_at: "2026-09-29T09:40:00Z",
      author_id: "admin1",
      author_role: "admin",
      visible_to_tenant: false,
    },
    {
      id: "n3",
      body: "9 to 1 please",
      created_at: "2026-09-29T10:00:00Z",
      author_id: "u1",
      author_role: "tenant",
      visible_to_tenant: true,
    },
  ],
};

function stubApi() {
  const posts: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return Response.json({ note: {} });
      }
      return Response.json(TICKET);
    }),
  );
  return posts;
}

async function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <Suspense fallback={null}>
          <AdminSupportTicketPage params={PARAMS} />
        </Suspense>
      </QueryClientProvider>,
    );
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  toastError.mockClear();
  toastSuccess.mockClear();
});

// COCKPIT-F25
describe("Admin support ticket thread", () => {
  it("labels each note's author and marks internal notes", async () => {
    stubApi();
    await renderPage();
    expect(await screen.findByText("Sure, which hours?")).toBeInTheDocument();
    expect(screen.getAllByText("Support team")).toHaveLength(2);
    expect(screen.getAllByText("Tenant")).toHaveLength(1);
    // only the hidden note carries the badge
    const internalBadge = screen.getByText("Internal");
    expect(internalBadge.closest("div")).toHaveTextContent("They asked twice already");
    expect(screen.getAllByText("Internal")).toHaveLength(1);
  });

  it("sends a reply visible to the tenant and confirms it", async () => {
    const posts = stubApi();
    await renderPage();
    await userEvent.type(await screen.findByLabelText("Reply to the tenant"), "Done!");
    await userEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ body: "Done!", visible_to_tenant: true });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Reply sent to the tenant"));
  });

  it("saves an internal note with visible_to_tenant=false", async () => {
    const posts = stubApi();
    await renderPage();
    await userEvent.click(
      await screen.findByRole("checkbox", { name: "Internal note (not visible to the tenant)" }),
    );
    await userEvent.type(screen.getByLabelText("Internal note"), "Call them back");
    await userEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ body: "Call them back", visible_to_tenant: false });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Internal note saved"));
  });
});
