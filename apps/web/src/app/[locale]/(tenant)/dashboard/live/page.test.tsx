import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";

const maybeSingle = vi.fn(async () => ({ data: { timezone: "America/Chicago" }, error: null }));
const eqCalls: [string, unknown][] = [];
const tenantsQuery = {
  select: vi.fn(() => tenantsQuery),
  eq: vi.fn((col: string, val: unknown) => {
    eqCalls.push([col, val]);
    return tenantsQuery;
  }),
  maybeSingle,
};

vi.mock("@/lib/auth/require-tenant-session", () => ({
  requireTenantSession: vi.fn(async () => ({
    supabase: { from: vi.fn(() => tenantsQuery) },
    tenant: { id: "t1", name: "Golden Fork Bistro", vertical: "restaurant" },
  })),
}));

vi.mock("@/components/live/live-screen", () => ({
  LiveScreen: () => null,
}));

import { LiveScreen } from "@/components/live/live-screen";
import { requireTenantSession } from "@/lib/auth/require-tenant-session";
import LiveScreenPage, { metadata } from "./page";

describe("/dashboard/live page (LIVE-1)", () => {
  it("has a real <title>", () => {
    expect(metadata.title).toBe("Live screen — Heyloo");
  });

  it("guards the route and hands the tenant's name, vertical and timezone to the screen", async () => {
    const element = await LiveScreenPage();
    expect(requireTenantSession).toHaveBeenCalledWith("/dashboard/live");
    expect(eqCalls).toContainEqual(["id", "t1"]);
    expect(isValidElement(element)).toBe(true);
    expect(element.type).toBe(LiveScreen);
    expect(element.props).toEqual({
      tenantId: "t1",
      businessName: "Golden Fork Bistro",
      vertical: "restaurant",
      timeZone: "America/Chicago",
    });
  });

  it("falls back to UTC when the tenant has no timezone row", async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null } as never);
    const element = await LiveScreenPage();
    expect(element.props.timeZone).toBe("UTC");
  });
});
