import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess } }));

const { default: RepliesPage } = await import("./page");

const REPLY_ID = "0d0d0d0d-0000-4000-8000-000000000001";

/** Real `GET admin-outreach/replies` row shape. */
const REPLIES = [
  {
    id: REPLY_ID,
    body: "Sounds good, send me a demo",
    ai_intent: "interested",
    received_at: "2026-09-29T10:00:00Z",
    lead_id: "l1",
    company_name: "Acme Law",
    contact_name: "Jo Park",
    email: "jo@acme.example",
    lead_status: "sent",
    campaign_name: "Q1 legal",
  },
];

function stubApi(actionStatus = 200, actionBody: unknown = { action: "mark_interested" }) {
  const posts: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push({ url: String(url), body: JSON.parse(String(init.body)) });
        return Response.json(actionBody, { status: actionStatus });
      }
      return Response.json({ replies: REPLIES });
    }),
  );
  return posts;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RepliesPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  toastError.mockClear();
  toastSuccess.mockClear();
});

// COCKPIT-F09
describe("Replies page", () => {
  it("maps the raw API row: lead name, intent badge and a real action", async () => {
    stubApi();
    renderPage();
    expect(await screen.findByText("Jo Park · Acme Law")).toBeInTheDocument();
    expect(screen.getByText("interested")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send demo link" })).toBeInTheDocument();
  });

  it("POSTs replies/:id/actions with { action }", async () => {
    const posts = stubApi();
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Send demo link" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      url: `/api/admin/admin-outreach/replies/${REPLY_ID}/actions`,
      body: { action: "mark_interested" },
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Demo link sent"));
  });

  it("explains a failure from the handler's own error code", async () => {
    stubApi(422, { error: "lead_has_no_email" });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Send demo link" }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("This lead has no email address to send to."),
    );
  });
});
