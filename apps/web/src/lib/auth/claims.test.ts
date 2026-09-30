import { describe, expect, it } from "vitest";
import { sessionAssuranceFromSupabaseClient } from "./claims";

function client(result: { data: unknown; error: unknown }) {
  // biome-ignore lint/suspicious/noExplicitAny: structural stub of the one auth method under test.
  return { auth: { getClaims: async () => result } } as any;
}

describe("sessionAssuranceFromSupabaseClient (SEC-01)", () => {
  it("reads the JWT's own aal and claims", async () => {
    const r = await sessionAssuranceFromSupabaseClient(
      client({
        data: { claims: { aal: "aal2", app_metadata: { platform_admin: true } } },
        error: null,
      }),
    );
    expect(r).toEqual({ claims: { platform_admin: true }, aal: "aal2", adminMfaRequired: false });
  });

  it("flags an aal1 admin token that only carries the MFA marker", async () => {
    const r = await sessionAssuranceFromSupabaseClient(
      client({
        data: { claims: { aal: "aal1", app_metadata: { admin_mfa_required: true } } },
        error: null,
      }),
    );
    expect(r).toEqual({ claims: {}, aal: "aal1", adminMfaRequired: true });
  });

  it("fails closed: no claims, no aal, no marker on error or garbage", async () => {
    const empty = { claims: {}, aal: null, adminMfaRequired: false };
    expect(await sessionAssuranceFromSupabaseClient(client({ data: null, error: {} }))).toEqual(
      empty,
    );
    expect(
      await sessionAssuranceFromSupabaseClient(
        client({ data: { claims: { aal: "bogus", app_metadata: "x" } }, error: null }),
      ),
    ).toEqual(empty);
  });
});
