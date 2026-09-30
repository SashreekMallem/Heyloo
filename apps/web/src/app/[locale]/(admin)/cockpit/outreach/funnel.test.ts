import { describe, expect, it } from "vitest";
import { buildOutreachFunnel, summarizeCac } from "./funnel";

// COCKPIT-F09
describe("buildOutreachFunnel", () => {
  it("turns the API's per-status counts into cumulative stages", () => {
    const stages = buildOutreachFunnel([
      { status: "new", count: 50 },
      { status: "queued", count: 20 },
      { status: "sent", count: 10 },
      { status: "replied", count: 4 },
      { status: "converted", count: 1 },
      { status: "suppressed", count: 5 },
    ]);
    expect(stages).toEqual([
      { label: "Sourced", count: 90 },
      { label: "In a campaign", count: 35 },
      { label: "Contacted", count: 15 },
      { label: "Replied", count: 5 },
      { label: "Converted", count: 1 },
    ]);
  });

  it("is empty (so the page shows its empty state) when there are no leads", () => {
    expect(buildOutreachFunnel([])).toEqual([]);
    expect(buildOutreachFunnel(undefined)).toEqual([]);
  });
});

describe("summarizeCac", () => {
  it("is total spend over converted tenants, rounded to cents", () => {
    expect(
      summarizeCac([
        { total_cost_cents: 10000, converted_tenant_count: 1 },
        { total_cost_cents: 5001, converted_tenant_count: 1 },
      ]),
    ).toBe(7501);
  });

  it("is null, never 0, while nothing has converted", () => {
    expect(summarizeCac([{ total_cost_cents: 10000, converted_tenant_count: 0 }])).toBeNull();
    expect(summarizeCac(undefined)).toBeNull();
  });
});
