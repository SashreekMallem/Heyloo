import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TenantIdProvider } from "@/lib/tenant/tenant-context";

import TeamPage from "./page";

function renderPage() {
  const client = new QueryClient();
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

  it("QA-1 AUTH-15: shows the invite form to the owner", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ members: [] })),
    );
    renderPage();
    await screen.findByText("No teammates yet");
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send invite" })).toBeInTheDocument();
    expect(screen.queryByTestId("team-owner-only")).not.toBeInTheDocument();
  });

  it("QA-1 AUTH-15: hides the invite form from an admin or member and says who to ask", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ members: [] })),
    );
    const client = new QueryClient();
    render(
      <TenantIdProvider tenantId="t1" canWrite isOwner={false}>
        <QueryClientProvider client={client}>
          <TeamPage />
        </QueryClientProvider>
      </TenantIdProvider>,
    );
    expect(await screen.findByText(/Ask your account owner to add teammates/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send invite" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Role" })).not.toBeInTheDocument();
  });
});
