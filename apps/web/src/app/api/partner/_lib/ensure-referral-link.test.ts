import { describe, expect, it, vi } from "vitest";

/**
 * Mocks `.from("referral_links").select(...).eq(...).maybeSingle()` and
 * `.from("referral_links").insert(...).select(...).single()`. `selectQueue`
 * is consumed in order (one entry per `select(...).eq(...).maybeSingle()`
 * call); `insertResult` answers the single `insert(...).select(...).single()`
 * call.
 */
function makeService(
  selectQueue: Array<{ code: string } | null>,
  insertResult: { code: string } | null,
) {
  let selectCalls = 0;
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({ data: selectQueue[selectCalls++] ?? null, error: null })),
      })),
    })),
    insert: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({
          data: insertResult,
          error: insertResult ? null : { message: "boom" },
        })),
      })),
    })),
  }));
  return { from };
}

const service = { from: vi.fn() };
vi.mock("@/lib/supabase/service-role", () => ({
  createSupabaseServiceRoleServerClient: () => service,
}));

const { ensurePartnerReferralLink } = await import("./ensure-referral-link");

describe("ensurePartnerReferralLink", () => {
  it("returns the existing code without inserting", async () => {
    const mock = makeService([{ code: "EXIST1" }], null);
    service.from.mockImplementation(mock.from);

    const code = await ensurePartnerReferralLink("partner-1");

    expect(code).toBe("EXIST1");
  });

  it("creates a link when none exists yet", async () => {
    const mock = makeService([null], { code: "NEWCODE" });
    service.from.mockImplementation(mock.from);

    const code = await ensurePartnerReferralLink("partner-2");

    expect(code).toBe("NEWCODE");
  });

  it("falls back to a re-select if a concurrent insert wins the unique-code race", async () => {
    const mock = makeService([null, { code: "RACE-WINNER" }], null);
    service.from.mockImplementation(mock.from);

    const code = await ensurePartnerReferralLink("partner-3");

    expect(code).toBe("RACE-WINNER");
  });

  it("returns null when no link exists and creation genuinely fails", async () => {
    const mock = makeService([null, null], null);
    service.from.mockImplementation(mock.from);

    const code = await ensurePartnerReferralLink("partner-4");

    expect(code).toBeNull();
  });
});
