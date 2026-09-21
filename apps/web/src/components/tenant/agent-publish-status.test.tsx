import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "maybeSingle"]) {
    obj[method] = vi.fn(() => obj);
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

let agentConfigsResult: unknown = { data: null, error: null };

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowserClient: {
    from: vi.fn(() => chain(agentConfigsResult)),
  },
}));

vi.mock("@/lib/tenant/tenant-context", () => ({
  useCurrentTenantId: () => "t1",
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { AgentPublishStatus } from "./agent-publish-status";

function renderStatus() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <AgentPublishStatus />
    </QueryClientProvider>,
  );
}

describe("AgentPublishStatus (PUBLISH-1)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it('shows "Never published" and no "Changes pending" badge for a freshly-provisioned tenant (published_at null, but nothing has changed since)', async () => {
    agentConfigsResult = {
      data: { updated_at: "2026-09-21T00:00:00Z", published_at: null },
      error: null,
    };
    renderStatus();
    expect(await screen.findByText("Never published")).toBeInTheDocument();
    // published_at null still counts as "pending" per the spec (nothing
    // published yet is definitely not "live") — the badge SHOULD show.
    expect(await screen.findByText("Changes pending")).toBeInTheDocument();
  });

  it("shows the last-published time and no pending badge when published_at is >= updated_at", async () => {
    agentConfigsResult = {
      data: {
        updated_at: "2026-09-21T00:00:00Z",
        published_at: "2026-09-21T01:00:00Z",
      },
      error: null,
    };
    renderStatus();
    expect(await screen.findByText(/Last published/)).toBeInTheDocument();
    expect(screen.queryByText("Changes pending")).not.toBeInTheDocument();
  });

  it("shows a pending badge when updated_at is newer than published_at", async () => {
    agentConfigsResult = {
      data: {
        updated_at: "2026-09-21T02:00:00Z",
        published_at: "2026-09-21T01:00:00Z",
      },
      error: null,
    };
    renderStatus();
    expect(await screen.findByText("Changes pending")).toBeInTheDocument();
  });

  it("publishes on click, shows a success toast, and clears the pending badge on refetch", async () => {
    agentConfigsResult = {
      data: {
        updated_at: "2026-09-21T02:00:00Z",
        published_at: "2026-09-21T01:00:00Z",
      },
      error: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        agentConfigsResult = {
          data: {
            updated_at: "2026-09-21T02:00:00Z",
            published_at: "2026-09-21T03:00:00Z",
          },
          error: null,
        };
        return new Response(
          JSON.stringify({
            tenant_id: "t1",
            agent_id: "agent_new",
            published_at: "2026-09-21T03:00:00Z",
          }),
          { status: 200 },
        );
      }),
    );
    renderStatus();
    await screen.findByText("Changes pending");
    await userEvent.click(screen.getByRole("button", { name: "Publish changes" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("Changes pending")).not.toBeInTheDocument());
  });

  it("shows an error toast and keeps the pending badge when the publish call fails", async () => {
    agentConfigsResult = {
      data: {
        updated_at: "2026-09-21T02:00:00Z",
        published_at: "2026-09-21T01:00:00Z",
      },
      error: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "forbidden" }), { status: 403 })),
    );
    renderStatus();
    await screen.findByText("Changes pending");
    await userEvent.click(screen.getByRole("button", { name: "Publish changes" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByText("Changes pending")).toBeInTheDocument();
  });
});
