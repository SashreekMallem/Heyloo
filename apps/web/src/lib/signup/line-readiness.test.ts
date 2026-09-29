import { describe, expect, it } from "vitest";
import { getLineReadiness } from "./line-readiness";

interface Tables {
  provisioning_runs?: { status: string } | null;
  agent_configs?: { published_at: string | null } | null;
  phone_numbers?: { e164: string } | null;
}

function fakeSupabase(tables: Tables) {
  return {
    from(table: keyof Tables) {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "limit"]) chain[m] = () => chain;
      chain["maybeSingle"] = () => Promise.resolve({ data: tables[table] ?? null });
      return chain;
    },
  } as never;
}

describe("getLineReadiness (the state provisioning -> forwarding is gated on)", () => {
  it("paid but saga not finished (no publish, no number): not ready — this is the state tenants.status='active' wrongly skipped", async () => {
    const r = await getLineReadiness(fakeSupabase({}), "t1");
    expect(r).toEqual({ published: false, number: null, ready: false });
  });

  it("number bought but agent not published yet: not ready", async () => {
    const r = await getLineReadiness(
      fakeSupabase({
        provisioning_runs: { status: "in_progress" },
        phone_numbers: { e164: "+15551230000" },
      }),
      "t1",
    );
    expect(r.ready).toBe(false);
    expect(r.number).toBe("+15551230000");
  });

  it("publish_agent succeeded but no live number: still not ready (never show codes without a number)", async () => {
    const r = await getLineReadiness(
      fakeSupabase({ provisioning_runs: { status: "succeeded" } }),
      "t1",
    );
    expect(r.ready).toBe(false);
  });

  it("publish_agent succeeded and a number exists: ready", async () => {
    const r = await getLineReadiness(
      fakeSupabase({
        provisioning_runs: { status: "succeeded" },
        phone_numbers: { e164: "+15551230000" },
      }),
      "t1",
    );
    expect(r).toEqual({ published: true, number: "+15551230000", ready: true });
  });

  it("a tenant provisioned outside the saga (agent has published_at) with a number is ready", async () => {
    const r = await getLineReadiness(
      fakeSupabase({
        agent_configs: { published_at: "2026-09-29T00:00:00Z" },
        phone_numbers: { e164: "+15551230000" },
      }),
      "t1",
    );
    expect(r.ready).toBe(true);
  });
});
