import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ push }),
}));
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess } }));
vi.mock("@heyloo/ui/charts", () => ({
  FunnelChart: ({ stages }: { stages: { label: string; count: number }[] }) => (
    <ul aria-label="funnel">
      {stages.map((s) => (
        <li key={s.label}>{`${s.label}: ${s.count}`}</li>
      ))}
    </ul>
  ),
}));

// `use(params)` needs a stable promise (a fresh one per render suspends forever).
const DETAIL_PARAMS = Promise.resolve({ id: "c1" });

// Radix's Select measures its trigger; jsdom has no ResizeObserver.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { default: CampaignsListPage } = await import("./page");
const { default: NewCampaignPage } = await import("./new/page");
const { default: CampaignDetailPage } = await import("./[id]/page");
const { describeCampaignCreateFailure } = await import("./new/create-campaign");

function withClient(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
  toastError.mockClear();
  toastSuccess.mockClear();
});

describe("campaigns list (COCKPIT-F08)", () => {
  it("reads the { campaigns } the API returns", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          campaigns: [
            {
              id: "c1",
              name: "Q1 legal",
              vertical: "legal",
              status: "draft",
              sender_domain: "mail.heyloo.ai",
              daily_send_cap: 250,
              complaint_rate: null,
            },
          ],
        }),
      ),
    );
    withClient(<CampaignsListPage />);
    expect(await screen.findByText("Q1 legal")).toBeInTheDocument();
    expect(screen.getByText("mail.heyloo.ai")).toBeInTheDocument();
    expect(screen.getByText("250")).toBeInTheDocument();
  });
});

describe("campaign detail (COCKPIT-F08)", () => {
  it("renders the funnel and leads the API returns", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          name: "Q1 legal",
          status: "draft",
          funnel: [
            { label: "Leads added", count: 10 },
            { label: "Sent", count: 8 },
          ],
          leads: [
            {
              id: "l1",
              companyName: "Acme Law",
              contactName: "Jo",
              email: "jo@acme.example",
              status: "sent",
              suppressed: false,
              isDuplicate: false,
              phoneComplaintScore: null,
            },
          ],
        }),
      ),
    );
    await act(async () => {
      withClient(
        <Suspense fallback={null}>
          <CampaignDetailPage params={DETAIL_PARAMS} />
        </Suspense>,
      );
    });
    expect(await screen.findByText("Q1 legal")).toBeInTheDocument();
    expect(screen.getByText("Sent: 8")).toBeInTheDocument();
    expect(screen.getByText("Acme Law")).toBeInTheDocument();
  });
});

describe("new campaign form", () => {
  async function fillValid() {
    await userEvent.type(screen.getByLabelText("Name"), "Q1 legal");
    await userEvent.type(screen.getByLabelText("Sending domain"), "Mail.Heyloo.ai");
  }

  it("posts the canonical body (sending_domain, daily_send_cap, template_id) to the campaigns route", async () => {
    const posts: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        posts.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return Response.json({ campaign_id: "c1" }, { status: 201 });
      }),
    );
    render(<NewCampaignPage />);
    await fillValid();
    await userEvent.click(screen.getByRole("button", { name: "Create campaign" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]?.url).toBe("/api/admin/admin-outreach/campaigns");
    expect(posts[0]?.body).toMatchObject({
      name: "Q1 legal",
      vertical: "generic",
      sending_domain: "mail.heyloo.ai",
      daily_send_cap: 100,
      respect_suppression: true,
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/cockpit/outreach/campaigns"));
  });

  it("F23: refuses a malformed domain without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<NewCampaignPage />);
    await userEvent.type(screen.getByLabelText("Name"), "Q1");
    await userEvent.type(screen.getByLabelText("Sending domain"), "not a domain");
    await userEvent.click(screen.getByRole("button", { name: "Create campaign" }));
    expect(await screen.findByText("Enter a domain such as mail.example.com")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("F08: a 501 says Smartlead isn't configured instead of 'backend endpoint pending'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "outreach_sender_not_configured" }, { status: 501 }),
      ),
    );
    render(<NewCampaignPage />);
    await fillValid();
    await userEvent.click(screen.getByRole("button", { name: "Create campaign" }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    const message = String(toastError.mock.calls[0]?.[0]);
    expect(message).toContain("Smartlead isn't configured");
    expect(message).not.toContain("pending");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("describeCampaignCreateFailure", () => {
  it("maps 422 issues onto form fields", () => {
    const failure = describeCampaignCreateFailure(422, {
      error: "invalid_campaign",
      issues: [
        { path: ["sending_domain"], message: "Enter a domain such as mail.example.com" },
        { path: ["unknown_field"], message: "ignored" },
      ],
    });
    expect(failure.fieldErrors).toEqual([
      { field: "sending_domain", message: "Enter a domain such as mail.example.com" },
    ]);
  });

  it("gives 502 and unknown statuses their own text", () => {
    expect(describeCampaignCreateFailure(502, null).message).toContain("Smartlead rejected");
    expect(describeCampaignCreateFailure(500, null).message).toContain("HTTP 500");
  });
});
