import { describe, expect, it, vi } from "vitest";
import { startTotpEnrollment } from "./mfa-enroll";

type Factor = { id: string; factor_type: string; status: "verified" | "unverified" };

function client(all: Factor[], overrides: { enrollError?: boolean; unenrollError?: boolean } = {}) {
  const enroll = vi.fn(async (params: { friendlyName?: string }) =>
    overrides.enrollError
      ? { data: null, error: { code: "mfa_factor_name_conflict" } }
      : {
          data: {
            id: "new-factor",
            totp: { qr_code: "data:image/svg+xml;utf8,qr", secret: "SECRET" },
          },
          error: null,
          params,
        },
  );
  const unenroll = vi.fn(async () =>
    overrides.unenrollError
      ? { data: null, error: { message: "nope" } }
      : { data: {}, error: null },
  );
  const listFactors = vi.fn(async () => ({
    data: { all, totp: all.filter((f) => f.factor_type === "totp" && f.status === "verified") },
    error: null,
  }));
  // biome-ignore lint/suspicious/noExplicitAny: structural test double for the two-method MFA surface.
  const supabase = { auth: { mfa: { enroll, unenroll, listFactors } } } as any;
  return { supabase, enroll, unenroll, listFactors };
}

describe("startTotpEnrollment (AUTH-03)", () => {
  it("enrols with a non-empty unique friendly name when there is nothing stale", async () => {
    const { supabase, enroll, unenroll } = client([]);
    const result = await startTotpEnrollment(supabase);
    expect(result).toEqual({
      status: "ready",
      factorId: "new-factor",
      qrCode: "data:image/svg+xml;utf8,qr",
      secret: "SECRET",
    });
    expect(unenroll).not.toHaveBeenCalled();
    const name = enroll.mock.calls[0]?.[0].friendlyName;
    expect(name).toMatch(/^Authenticator \S+/);
  });

  it("removes stale unverified TOTP factors before enrolling, so a revisit never conflicts", async () => {
    const { supabase, enroll, unenroll } = client([
      { id: "stale-1", factor_type: "totp", status: "unverified" },
      { id: "stale-2", factor_type: "totp", status: "unverified" },
      { id: "phone-1", factor_type: "phone", status: "unverified" },
    ]);
    const result = await startTotpEnrollment(supabase);
    expect(result.status).toBe("ready");
    expect(unenroll).toHaveBeenCalledTimes(2);
    expect(unenroll).toHaveBeenCalledWith({ factorId: "stale-1" });
    expect(unenroll).toHaveBeenCalledWith({ factorId: "stale-2" });
    expect(enroll).toHaveBeenCalledTimes(1);
  });

  it("uses a different friendly name on every call", async () => {
    const a = client([]);
    const b = client([]);
    await startTotpEnrollment(a.supabase);
    await startTotpEnrollment(b.supabase);
    expect(a.enroll.mock.calls[0]?.[0].friendlyName).not.toBe(
      b.enroll.mock.calls[0]?.[0].friendlyName,
    );
  });

  it("reports an existing verified factor instead of creating another", async () => {
    const { supabase, enroll, unenroll } = client([
      { id: "f1", factor_type: "totp", status: "verified" },
    ]);
    expect(await startTotpEnrollment(supabase)).toEqual({ status: "already_enrolled" });
    expect(enroll).not.toHaveBeenCalled();
    expect(unenroll).not.toHaveBeenCalled();
  });

  it("returns an error result (never throws) when enrolment or cleanup fails", async () => {
    expect(await startTotpEnrollment(client([], { enrollError: true }).supabase)).toEqual({
      status: "error",
    });
    expect(
      await startTotpEnrollment(
        client([{ id: "s", factor_type: "totp", status: "unverified" }], { unenrollError: true })
          .supabase,
      ),
    ).toEqual({ status: "error" });
  });
});
