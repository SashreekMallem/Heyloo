import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant/tenant-context", () => ({
  useCurrentTenantId: () => "t1",
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { AgentPublishStatus } from "./agent-publish-status";

type Status = { publishedAt: string | null; pending: boolean; reasons: string[] };

/** Routes `GET /api/tenant/agent/publish-status` (SETTINGS-1) and `POST /api/tenant/agent/publish`. */
function stubFetch(
  initial: Status,
  publish?: () => { status: number; body: unknown; next?: Status },
) {
  let status = initial;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/tenant/agent/publish-status")) return Response.json(status);
    if (url.endsWith("/api/tenant/agent/publish") && init?.method === "POST") {
      const result = publish?.() ?? { status: 200, body: {} };
      if (result.next) status = result.next;
      return new Response(JSON.stringify(result.body), { status: result.status });
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderStatus() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AgentPublishStatus />
    </QueryClientProvider>,
  );
}

describe("AgentPublishStatus (PUBLISH-1, SETTINGS-1)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it('shows "Never published" with a pending badge and its reason for a fresh tenant', async () => {
    stubFetch({ publishedAt: null, pending: true, reasons: ["never_published"] });
    renderStatus();
    expect(await screen.findByText("Never published")).toBeInTheDocument();
    expect(screen.getByText("Changes pending")).toBeInTheDocument();
    expect(screen.getByText(/hasn't been published yet/)).toBeInTheDocument();
  });

  it("shows no pending badge for an up-to-date agent (next-call edits no longer light it)", async () => {
    stubFetch({ publishedAt: "2026-09-21T01:00:00Z", pending: false, reasons: [] });
    renderStatus();
    expect(await screen.findByText(/Last published/)).toBeInTheDocument();
    expect(screen.queryByText("Changes pending")).not.toBeInTheDocument();
  });

  it("explains a pending language change", async () => {
    stubFetch({
      publishedAt: "2026-09-21T01:00:00Z",
      pending: true,
      reasons: ["language_changed"],
    });
    renderStatus();
    expect(await screen.findByText("Changes pending")).toBeInTheDocument();
    expect(screen.getByText(/changed the call language/)).toBeInTheDocument();
  });

  it("publishes on click, shows a success toast, and clears the pending badge on refetch", async () => {
    stubFetch(
      { publishedAt: "2026-09-21T01:00:00Z", pending: true, reasons: ["platform_update"] },
      () => ({
        status: 200,
        body: { tenant_id: "t1", agent_id: "agent_new" },
        next: { publishedAt: "2026-09-21T03:00:00Z", pending: false, reasons: [] },
      }),
    );
    renderStatus();
    await screen.findByText("Changes pending");
    await userEvent.click(screen.getByRole("button", { name: "Publish changes" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("Changes pending")).not.toBeInTheDocument());
  });

  it("shows an error toast and keeps the pending badge when the publish call fails", async () => {
    stubFetch(
      { publishedAt: "2026-09-21T01:00:00Z", pending: true, reasons: ["language_changed"] },
      () => ({
        status: 403,
        body: { error: "forbidden" },
      }),
    );
    renderStatus();
    await screen.findByText("Changes pending");
    await userEvent.click(screen.getByRole("button", { name: "Publish changes" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByText("Changes pending")).toBeInTheDocument();
  });

  it("renders nothing but the button when the status route fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    renderStatus();
    expect(await screen.findByRole("button", { name: "Publish changes" })).toBeInTheDocument();
    expect(screen.queryByText("Changes pending")).not.toBeInTheDocument();
  });
});
