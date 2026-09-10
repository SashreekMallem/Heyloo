import { describe, expect, it, vi } from "vitest";

class RedirectSignal extends Error {
  constructor(public destination: string) {
    super(`NEXT_REDIRECT:${destination}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (destination: string) => {
    throw new RedirectSignal(destination);
  },
}));

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "maybeSingle"]) {
    obj[method] = vi.fn(() => obj);
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

let mockUser: unknown = null;
let partnerResult: unknown = { data: null, error: null };

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: mockUser } }) },
    from: vi.fn(() => chain(partnerResult)),
  }),
}));

const { requirePartnerSession, CURRENT_FTC_POLICY_VERSION } = await import(
  "./require-partner-session"
);

async function redirectedTo(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    throw new Error("expected a redirect, none happened");
  } catch (error) {
    if (error instanceof RedirectSignal) return error.destination;
    throw error;
  }
}

describe("requirePartnerSession", () => {
  it("redirects to /login with the next path when there is no user", async () => {
    mockUser = null;
    const dest = await redirectedTo(requirePartnerSession("/portal"));
    expect(dest).toBe(`/login?next=${encodeURIComponent("/portal")}`);
  });

  it("redirects to the no_access toast when the caller has no referral_partner_id claim", async () => {
    mockUser = { id: "u1", app_metadata: { tenant_id: "t1", role: "owner" } };
    const dest = await redirectedTo(requirePartnerSession("/portal"));
    expect(dest).toBe("/?toast=no_access");
  });

  it("redirects to the no_access toast when the claim doesn't resolve to a real partner row", async () => {
    mockUser = { id: "u1", app_metadata: { referral_partner_id: "p1" } };
    partnerResult = { data: null, error: null };
    const dest = await redirectedTo(requirePartnerSession("/portal"));
    expect(dest).toBe("/?toast=no_access");
  });

  it("reports unacknowledged when ftc_acknowledged_version doesn't match the current policy version", async () => {
    mockUser = { id: "u1", app_metadata: { referral_partner_id: "p1" } };
    partnerResult = {
      data: {
        id: "p1",
        name: "Acme Referrals",
        w9_status: "on_file",
        ftc_acknowledged_at: "2025-01-01T00:00:00Z",
        ftc_acknowledged_version: "2025-01",
      },
      error: null,
    };
    const result = await requirePartnerSession("/portal");
    expect(result.acknowledged).toBe(false);
  });

  it("reports acknowledged for the current policy version and returns the partner row", async () => {
    mockUser = { id: "u1", app_metadata: { referral_partner_id: "p1" } };
    partnerResult = {
      data: {
        id: "p1",
        name: "Acme Referrals",
        w9_status: "on_file",
        ftc_acknowledged_at: "2026-09-01T00:00:00Z",
        ftc_acknowledged_version: CURRENT_FTC_POLICY_VERSION,
      },
      error: null,
    };
    const result = await requirePartnerSession("/portal");
    expect(result.acknowledged).toBe(true);
    expect(result.partner.id).toBe("p1");
  });
});
