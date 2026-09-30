import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let referralRows: { status: string }[] = [];
let commissionRows: { amount_cents: number; status: string }[] = [];
let funnelStages: { label: string; count: number }[] = [];

vi.mock("@/lib/auth/require-partner-session", () => ({
  requirePartnerSession: async () => ({
    partner: { id: "partner-1" },
    supabase: {
      from: (table: string) => ({
        select: () => ({
          eq: async () => ({ data: table === "referrals" ? referralRows : commissionRows }),
        }),
      }),
    },
  }),
}));
vi.mock("@/app/api/partner/_lib/ensure-referral-link", () => ({
  ensurePartnerReferralLink: async () => "ABCD2345",
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "heyloo.app", "x-forwarded-proto": "https" }),
}));
vi.mock("@/components/partner/copy-link-button", () => ({
  CopyLinkButton: ({ link }: { link: string }) => (
    <button type="button" aria-label="Copy link" data-link={link} />
  ),
}));
vi.mock("@heyloo/ui/charts", () => ({
  FunnelChart: ({ stages }: { stages: { label: string; count: number }[] }) => {
    funnelStages = stages;
    return <div data-testid="funnel" />;
  },
}));

const { default: PartnerDashboardPage } = await import("./page");

describe("PartnerDashboardPage (PT-06)", () => {
  beforeEach(() => {
    referralRows = [];
    commissionRows = [];
    funnelStages = [];
  });

  it("shows the absolute referral URL, and copies that same URL", async () => {
    render(await PartnerDashboardPage());
    expect(screen.getByText("https://heyloo.app/signup?ref=ABCD2345")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy link" }).getAttribute("data-link")).toBe(
      "https://heyloo.app/signup?ref=ABCD2345",
    );
  });

  it("has no hard-coded Clicks stage in the funnel", async () => {
    referralRows = [{ status: "pending" }, { status: "qualified" }, { status: "paid" }];
    render(await PartnerDashboardPage());
    expect(funnelStages.map((s) => s.label)).toEqual(["Signups", "Qualified", "Paid"]);
    expect(funnelStages.map((s) => s.count)).toEqual([3, 2, 1]);
  });

  it("shows earned and pending dollars from commission_events", async () => {
    referralRows = [{ status: "paid" }];
    commissionRows = [
      { amount_cents: 15000, status: "paid" },
      { amount_cents: 2500, status: "accrued" },
      { amount_cents: 500, status: "batched" },
      { amount_cents: 99900, status: "clawed_back" },
    ];
    render(await PartnerDashboardPage());
    expect(screen.getByText("Earned (paid out)")).toBeInTheDocument();
    expect(screen.getByText("$150.00")).toBeInTheDocument();
    expect(screen.getByText("Pending payout")).toBeInTheDocument();
    expect(screen.getByText("$30.00")).toBeInTheDocument();
  });

  it("shows the empty-state card, not zeroed metrics, before any referral", async () => {
    render(await PartnerDashboardPage());
    expect(screen.getByText(/No referrals yet/)).toBeInTheDocument();
    expect(screen.queryByText("Earned (paid out)")).not.toBeInTheDocument();
  });
});
