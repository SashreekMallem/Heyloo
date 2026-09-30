import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TenantIdProvider } from "@/lib/tenant/tenant-context";

import TeamPage from "./page";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <TenantIdProvider tenantId="t1">
      <QueryClientProvider client={client}>
        <TeamPage />
      </QueryClientProvider>
    </TenantIdProvider>,
  );
}

describe("TeamPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never crashes and reads as empty when the response doesn't include a members array", async () => {
    // e.g. a generic fallback / mismatched-shape payload with no `members`.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ rows: [] })),
    );
    renderPage();
    expect(await screen.findByText("No teammates yet")).toBeInTheDocument();
  });

  it("gives the Role select trigger an accessible name via the visible Label", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ members: [] })),
    );
    renderPage();
    await screen.findByText("No teammates yet");
    expect(screen.getByRole("combobox", { name: "Role" })).toBeInTheDocument();
  });

  it("renders real teammates once loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          members: [
            {
              id: "m1",
              role: "owner",
              email: "owner@example.com",
              invited_email: null,
              accepted: true,
              created_at: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      ),
    );
    renderPage();
    expect(await screen.findByText("owner@example.com")).toBeInTheDocument();
  });

  it("MAP-20: a failed load reads as a sentence-case message, not 'failed to load team'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    renderPage();
    expect(await screen.findByText("We couldn't load your team. Try again.")).toBeInTheDocument();
    expect(screen.queryByText("failed to load team")).not.toBeInTheDocument();
  });
});
