import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const NOW = new Date("2026-10-11T12:00:00Z");

vi.mock("next/navigation", () => ({
  redirect: (destination: string) => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  },
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/perf/sentry-init", () => ({ SentryInit: () => null }));
vi.mock("@heyloo/ui/layout/branding-provider", () => ({ BrandingProvider: () => null }));
vi.mock("@/lib/realtime/tenant-realtime-provider", () => ({
  TenantRealtimeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/tenant/tenant-shell-client", () => ({
  TenantShellClient: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const usageQuery = {
  table: "",
  filters: [] as [string, string, unknown][],
};
let usageRows: { minutes: number | string }[] = [];
let tenant: Record<string, unknown> = {};

function usageChain() {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "lt"]) {
    obj[method] = vi.fn((column: string, value: unknown) => {
      usageQuery.filters.push([method, column, value]);
      return obj;
    });
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve({ data: usageRows, error: null }).then(resolve);
  return obj;
}

vi.mock("@/lib/auth/require-tenant-session", () => ({
  requireTenantSession: async () => ({
    claims: { tenant_id: "t1", role: "owner" },
    user: { id: "u1" },
    tenant,
    supabase: {
      from: (table: string) => {
        usageQuery.table = table;
        return usageChain();
      },
    },
  }),
}));

const { default: TenantLayout } = await import("./layout");

const BASE_TENANT = {
  id: "t1",
  name: "Joe's Garage",
  status: "active",
  branding: {},
  manual_mode: false,
  manual_mode_enabled_at: null,
  trial_ends_at: null,
  trial_minutes_cap: null,
  trial_ended_reason: null,
  trial_cancel_scheduled: false,
};

async function renderLayout() {
  render(await TenantLayout({ children: <p>dashboard</p> }));
}

describe("(tenant) layout free-trial banner (TRIAL-1)", () => {
  afterEach(() => {
    vi.useRealTimers();
    usageRows = [];
    usageQuery.table = "";
    usageQuery.filters = [];
  });

  it("shows days left and trial minutes used while the trial runs", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    tenant = {
      ...BASE_TENANT,
      trial_ends_at: "2026-10-16T09:00:00Z", // 4 days 21 hours away
      trial_minutes_cap: 100,
    };
    usageRows = [{ minutes: 10.5 }, { minutes: "2.75" }];
    await renderLayout();
    expect(screen.getByTestId("free-trial-banner")).toHaveTextContent(
      "Free trial — 5 days left · 13 of 100 minutes used. Your plan starts when either runs out.",
    );
    expect(screen.getByRole("link", { name: "Billing" })).toHaveAttribute(
      "href",
      "/dashboard/billing",
    );
    expect(screen.getByText("dashboard")).toBeInTheDocument();
    // billable usage before the trial's end only
    expect(usageQuery.table).toBe("usage_events");
    expect(usageQuery.filters).toEqual(
      expect.arrayContaining([
        ["eq", "tenant_id", "t1"],
        ["eq", "is_billable", true],
        ["lt", "occurred_at", "2026-10-16T09:00:00Z"],
      ]),
    );
  });

  it("says 1 day left on the last day and never shows more minutes than the cap", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    tenant = { ...BASE_TENANT, trial_ends_at: "2026-10-11T20:00:00Z", trial_minutes_cap: 100 };
    usageRows = [{ minutes: 100.4 }];
    await renderLayout();
    expect(screen.getByTestId("free-trial-banner")).toHaveTextContent(
      "Free trial — 1 day left · 100 of 100 minutes used.",
    );
  });

  it("tells an owner who canceled during the trial that nothing will be charged", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    tenant = {
      ...BASE_TENANT,
      trial_ends_at: "2026-10-16T09:00:00Z",
      trial_minutes_cap: 100,
      trial_cancel_scheduled: true,
    };
    usageRows = [{ minutes: 120 }];
    await renderLayout();
    const banner = screen.getByTestId("free-trial-banner");
    expect(banner).toHaveTextContent(
      "Free trial — 5 days left · 100 of 100 minutes used. You canceled, so your subscription ends with the trial and you won't be charged.",
    );
    expect(banner).not.toHaveTextContent("Your plan starts");
  });

  it("shows no banner for a tenant that is not on a trial", async () => {
    tenant = { ...BASE_TENANT };
    await renderLayout();
    expect(screen.queryByTestId("free-trial-banner")).not.toBeInTheDocument();
    expect(usageQuery.table).toBe("");
  });

  it.each(["minutes", "time", "canceled"])(
    "shows no banner once the trial ended (%s)",
    async (reason) => {
      vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
      tenant = {
        ...BASE_TENANT,
        trial_ends_at: "2026-10-16T09:00:00Z",
        trial_minutes_cap: 100,
        trial_ended_reason: reason,
      };
      await renderLayout();
      expect(screen.queryByTestId("free-trial-banner")).not.toBeInTheDocument();
    },
  );

  it("shows no banner after the scheduled end, even before the end is recorded", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    tenant = { ...BASE_TENANT, trial_ends_at: "2026-10-10T09:00:00Z", trial_minutes_cap: 100 };
    await renderLayout();
    expect(screen.queryByTestId("free-trial-banner")).not.toBeInTheDocument();
  });
});
