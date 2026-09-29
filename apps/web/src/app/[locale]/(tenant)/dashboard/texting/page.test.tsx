import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessagingSetupResponse } from "@/lib/messaging/texting-setup";
import TextingPage from "./page";

function renderWith(response: MessagingSetupResponse) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(response)),
  );
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TextingPage />
    </QueryClientProvider>,
  );
}

describe("TextingPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("says honestly that texting isn't set up and that alerts are emailed meanwhile", async () => {
    renderWith({ state: "not_started", sender: null, profile: null, can_edit: true });
    expect(await screen.findByText("Texting isn't set up yet")).toBeInTheDocument();
    expect(screen.getByText(/emailed to you instead/)).toBeInTheDocument();
    expect(screen.getByText(/Texting is off until it's set up/)).toBeInTheDocument();
    expect(screen.getByText(/won't offer or promise texts on calls/)).toBeInTheDocument();
    expect(screen.getByLabelText("Legal business name")).toBeInTheDocument();
    expect(screen.getByLabelText("EIN")).toBeInTheDocument();
  });

  it("shows the number under review and a realistic timeline", async () => {
    renderWith({
      state: "in_review",
      sender: {
        e164: "+18885550100",
        kind: "toll_free",
        registration_status: "in_review",
        failure_reason: null,
      },
      profile: null,
      can_edit: true,
    });
    expect(
      await screen.findByText("Carriers are reviewing your texting number"),
    ).toBeInTheDocument();
    expect(screen.getByText(/\(888\) 555-0100 is waiting on carrier approval/)).toBeInTheDocument();
    expect(screen.getByText(/about 1–2 weeks/)).toBeInTheDocument();
    expect(
      screen.getByText(/Texting stays off, and you'll keep getting email alerts/),
    ).toBeInTheDocument();
  });

  it("never crashes on an unexpected response shape (falls back to not set up)", async () => {
    renderWith({ rows: [] } as unknown as MessagingSetupResponse);
    expect(await screen.findByText("Texting isn't set up yet")).toBeInTheDocument();
  });

  it("hides the business details form from team members who can't edit it", async () => {
    renderWith({ state: "active", sender: null, profile: null, can_edit: false });
    expect(await screen.findByText("Texting is on")).toBeInTheDocument();
    expect(screen.queryByLabelText("Legal business name")).not.toBeInTheDocument();
    expect(screen.getByText(/Only the account owner or an admin/)).toBeInTheDocument();
  });
});
