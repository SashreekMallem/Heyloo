import type { SupabaseServiceRoleClient } from "@heyloo/supabase-client";
import { describe, expect, it, vi } from "vitest";
import { generateReferralCode, insertReferralLink } from "./referral-code";

describe("generateReferralCode (SEC-11)", () => {
  it("is 8 characters from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateReferralCode()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    }
  });

  it("does not repeat across a large sample (CSPRNG, not a 6-char Math.random slice)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i += 1) seen.add(generateReferralCode());
    expect(seen.size).toBe(5000);
  });

  it("does not use Math.random", () => {
    const spy = vi.spyOn(Math, "random");
    generateReferralCode();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

function makeService(results: Array<{ data: { code: string } | null; error: { code?: string } | null }>) {
  const codes: string[] = [];
  let call = 0;
  const service = {
    from: () => ({
      insert: (row: { code: string }) => {
        codes.push(row.code);
        return {
          select: () => ({ single: async () => results[call++] ?? { data: null, error: {} } }),
        };
      },
    }),
  } as unknown as SupabaseServiceRoleClient;
  return { service, codes };
}

describe("insertReferralLink (SEC-11)", () => {
  it("retries with a NEW code on a unique-code collision instead of failing", async () => {
    const { service, codes } = makeService([
      { data: null, error: { code: "23505" } },
      { data: { code: "GOODCODE" }, error: null },
    ]);
    const code = await insertReferralLink(service, "partner-1");
    expect(code).toBe("GOODCODE");
    expect(codes).toHaveLength(2);
    expect(codes[0]).not.toBe(codes[1]);
  });

  it("gives up (null) on a non-unique error without retrying", async () => {
    const { service, codes } = makeService([{ data: null, error: { code: "42501" } }]);
    expect(await insertReferralLink(service, "partner-1")).toBeNull();
    expect(codes).toHaveLength(1);
  });

  it("gives up after a bounded number of collisions", async () => {
    const collision = { data: null, error: { code: "23505" } };
    const { service, codes } = makeService(Array.from({ length: 20 }, () => collision));
    expect(await insertReferralLink(service, "partner-1")).toBeNull();
    expect(codes.length).toBeLessThanOrEqual(5);
  });
});
