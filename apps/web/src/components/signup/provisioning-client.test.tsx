import { screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type FakeResult, fake } from "@/test/fake-supabase";
import { renderWithTenant } from "@/test/render-with-tenant";

vi.mock("@/lib/supabase/browser", async () => {
  const { fakeClient } = await import("@/test/fake-supabase");
  return { supabaseBrowserClient: fakeClient() };
});
vi.mock("@/lib/realtime/tenant-realtime-provider", () => ({
  TenantRealtimeProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { ProvisioningClient } = await import("./provisioning-client");

type Status = "pending" | "in_progress" | "succeeded" | "failed";

function seed(finalize: Status | null, trialEndsAt: string | null) {
  fake.queue("provisioning_runs:select", {
    data: finalize ? [{ step: "tenant_finalize", status: finalize }] : [],
    error: null,
  });
  fake.queue("tenants:select", { data: { trial_ends_at: trialEndsAt }, error: null });
}

// TRIAL-1: the first step must not say "Payment confirmed" when the free trial
// meant nothing was charged.
describe("ProvisioningClient first step", () => {
  beforeEach(() => fake.reset());

  it("says the card was added and the trial started once the trial is recorded", async () => {
    seed("succeeded", "2026-10-18T12:00:00Z");
    renderWithTenant(<ProvisioningClient tenantId="t1" />);
    expect(await screen.findByText("Card added — trial started")).toBeInTheDocument();
    expect(screen.queryByText(/Payment confirmed/)).not.toBeInTheDocument();
    expect(fake.callsTo("tenants")[0]).toMatchObject({
      columns: "trial_ends_at",
      filters: [["eq", "id", "t1"]],
    });
  });

  it("reads the trial only after the runs read has answered", async () => {
    // The runs answer is held back: a parallel read (Promise.all) would query
    // `tenants` before it arrives, and could see the trial missing while the
    // runs already say `tenant_finalize` succeeded.
    let release: (result: FakeResult) => void = () => undefined;
    const held = new Promise<FakeResult>((resolve) => {
      release = resolve;
    });
    // The fake answers with `Promise.resolve(result)`, which waits on a promise.
    fake.queue("provisioning_runs:select", held as unknown as FakeResult);
    fake.queue("tenants:select", { data: { trial_ends_at: "2026-10-18T12:00:00Z" }, error: null });
    renderWithTenant(<ProvisioningClient tenantId="t1" />);
    await waitFor(() => expect(fake.callsTo("provisioning_runs")).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.callsTo("tenants")).toHaveLength(0);
    release({ data: [{ step: "tenant_finalize", status: "succeeded" }], error: null });
    expect(await screen.findByText("Card added — trial started")).toBeInTheDocument();
    expect(fake.calls.map((c) => c.table)).toEqual(["provisioning_runs", "tenants"]);
  });

  it("never says payment confirmed when the trial read fails", async () => {
    fake.queue("provisioning_runs:select", {
      data: [{ step: "tenant_finalize", status: "succeeded" }],
      error: null,
    });
    fake.queue("tenants:select", { data: null, error: { message: "network down" } });
    renderWithTenant(<ProvisioningClient tenantId="t1" />);
    await waitFor(() => expect(fake.callsTo("tenants")).toHaveLength(1));
    expect(await screen.findByText("Card added")).toBeInTheDocument();
    expect(screen.queryByText(/Payment confirmed/)).not.toBeInTheDocument();
  });

  it("keeps the trial wording when a later trial read fails", async () => {
    const finalized = {
      data: [{ step: "tenant_finalize", status: "succeeded" }],
      error: null,
    };
    fake.queue("provisioning_runs:select", finalized, finalized);
    fake.queue(
      "tenants:select",
      { data: { trial_ends_at: "2026-10-18T12:00:00Z" }, error: null },
      { data: null, error: { message: "network down" } },
    );
    renderWithTenant(<ProvisioningClient tenantId="t1" />);
    expect(await screen.findByText("Card added — trial started")).toBeInTheDocument();
    // The next 2.5 s poll fails its trial read.
    await waitFor(() => expect(fake.callsTo("tenants")).toHaveLength(2), { timeout: 4000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText("Card added — trial started")).toBeInTheDocument();
    expect(screen.queryByText(/Payment confirmed/)).not.toBeInTheDocument();
  }, 8000);

  it("shows the trial wording while the step is still pending", async () => {
    seed("in_progress", "2026-10-18T12:00:00Z");
    renderWithTenant(<ProvisioningClient tenantId="t1" />);
    expect(await screen.findByText("Card added — trial started")).toBeInTheDocument();
  });

  it("says payment confirmed when the step succeeded without a trial (the business already had one)", async () => {
    seed("succeeded", null);
    renderWithTenant(<ProvisioningClient tenantId="t1" />);
    expect(await screen.findByText("Payment confirmed")).toBeInTheDocument();
    expect(screen.queryByText(/trial started/)).not.toBeInTheDocument();
  });

  it("stays neutral before Checkout's outcome is known", async () => {
    seed(null, null);
    renderWithTenant(<ProvisioningClient tenantId="t1" />);
    expect(await screen.findByText("Card added")).toBeInTheDocument();
    expect(screen.queryByText(/Payment confirmed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/trial started/)).not.toBeInTheDocument();
  });
});
