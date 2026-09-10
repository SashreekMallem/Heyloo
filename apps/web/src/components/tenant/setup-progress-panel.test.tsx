import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SetupProgressResponse } from "@/app/api/tenant/setup-progress/route";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { SetupProgressPanel } from "./setup-progress-panel";

function renderPanel(tenantId = "t1") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SetupProgressPanel tenantId={tenantId} />
    </QueryClientProvider>,
  );
}

function mockResponse(overrides: Partial<SetupProgressResponse> = {}): SetupProgressResponse {
  return {
    steps: [
      {
        id: "paid",
        label: "Add a payment method",
        description: "",
        href: "/dashboard/billing",
        done: false,
        optional: false,
      },
      {
        id: "team_invited",
        label: "Invite your team",
        description: "",
        href: null,
        done: false,
        optional: true,
      },
    ],
    requiredTotal: 1,
    requiredDone: 0,
    complete: false,
    ...overrides,
  };
}

describe("SetupProgressPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders incomplete steps with a link and no dismiss control", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(mockResponse()), { status: 200 })),
    );
    renderPanel();
    expect(await screen.findByText("Add a payment method")).toBeInTheDocument();
    expect(screen.getByText("0 of 1 steps complete")).toBeInTheDocument();
    expect(screen.queryByLabelText("Dismiss")).not.toBeInTheDocument();
  });

  it("shows a dismiss control once every required step is done", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(mockResponse({ requiredDone: 1, complete: true })), {
            status: 200,
          }),
      ),
    );
    renderPanel();
    expect(await screen.findByLabelText("Dismiss")).toBeInTheDocument();
  });

  it("renders nothing (never crashes) when the response doesn't match the expected shape", async () => {
    // e.g. a generic `{ rows: [] }` fallback with no `steps` array — must
    // never reach `steps.map` on `undefined`.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ rows: [] }), { status: 200 })),
    );
    const { container } = renderPanel();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("renders nothing (never crashes) on a fetch error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("oops", { status: 500 })),
    );
    const { container } = renderPanel();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("renders nothing once dismissed (persisted per-tenant in localStorage)", async () => {
    window.localStorage.setItem("heyloo:setup-progress-dismissed:t1", "1");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify(mockResponse({ complete: true })), { status: 200 }),
      ),
    );
    const { container } = renderPanel();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
