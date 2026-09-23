import { beforeEach, describe, expect, it, vi } from "vitest";

// index.ts is a Deno entrypoint: it calls `Deno.serve(...)` at module scope
// and reads `INTAKE_ENCRYPTION_KEY` via `requireEnv` (through `Deno.env.get`)
// at cold start. Neither exists under Node/Vitest, so we shim the minimal
// `Deno` surface it touches BEFORE importing it, capturing the request
// handler `Deno.serve` receives so we can drive it with a real `Request` —
// the only way to exercise the actual `url.pathname` -> `token` extraction
// this repo's test suite otherwise skips entirely (`handler.test.ts` calls
// `getIntakeStatus`/`submitIntake` directly with hand-built token strings).
//
// FOLLOWUP-1 (docs/BUILD_NOTES.md): mirrors `admin/index.test.ts`'s own
// QA-PORTAL fix — these requests use the REAL, live-confirmed URL shape
// Supabase's edge runtime actually delivers to `Deno.serve` (`/functions/v1/`
// stripped, the function's OWN name segment `api-intake` still present),
// not the fictional `/functions/v1/api-intake/{token}` shape the old,
// buggy implementation (and any test built against it) assumed.

let capturedHandler: ((req: Request) => Response | Promise<Response>) | undefined;

vi.stubGlobal("Deno", {
  serve: (handler: (req: Request) => Response | Promise<Response>) => {
    capturedHandler = handler;
  },
  env: { get: (name: string) => (name === "INTAKE_ENCRYPTION_KEY" ? "test-key" : undefined) },
});

vi.mock("../_shared/deno/db.ts", () => ({
  getSql: () => ({}) as unknown,
}));

const getIntakeStatusSpy = vi.fn(async (_sql: unknown, token: string) => ({
  status: 200 as const,
  body: {
    valid: true as const,
    tenant_name: "Test Tenant",
    patient_first_name: null,
    already_submitted: false,
    receivedToken: token,
  },
}));
const submitIntakeSpy = vi.fn(async (_sql: unknown, token: string) => ({
  status: 200 as const,
  body: { ok: true as const, receivedToken: token },
}));

vi.mock("./handler.ts", () => ({
  getIntakeStatus: (...args: Parameters<typeof getIntakeStatusSpy>) => getIntakeStatusSpy(...args),
  submitIntake: (...args: unknown[]) => submitIntakeSpy(args[0] as unknown, args[1] as string),
}));

await import("./index.ts");

describe("api-intake function entrypoint — URL to token extraction", () => {
  beforeEach(() => {
    getIntakeStatusSpy.mockClear();
    submitIntakeSpy.mockClear();
  });

  // FOLLOWUP-1: the real shape Supabase's edge runtime delivers — the
  // function's own name segment (`api-intake`) is still present on
  // `req.url`'s pathname; only `/functions/v1/` is stripped upstream.
  it("strips the function's own name segment so the real token is extracted, not the fictional /functions/v1/ prefix", async () => {
    expect(capturedHandler).toBeDefined();

    const req = new Request("https://project.supabase.co/api-intake/abc123opaquetoken", {
      method: "GET",
    });
    const res = await capturedHandler?.(req);
    const body = await res?.json();

    expect(getIntakeStatusSpy).toHaveBeenCalledTimes(1);
    const tokenArg = getIntakeStatusSpy.mock.calls[0]?.[1];
    expect(tokenArg).toBe("abc123opaquetoken");
    expect(res?.status).toBe(200);
    expect(body).toEqual({
      valid: true,
      tenant_name: "Test Tenant",
      patient_first_name: null,
      already_submitted: false,
      receivedToken: "abc123opaquetoken",
    });
  });

  it("would resolve the wrong token (function-name segment glued on) if the old /functions/v1/ prefix assumption were still in place (regression guard)", async () => {
    const req = new Request("https://project.supabase.co/api-intake/realtoken456", {
      method: "GET",
    });
    await capturedHandler?.(req);

    const tokenArg = getIntakeStatusSpy.mock.calls[0]?.[1];
    expect(tokenArg).toBe("realtoken456");
    expect((tokenArg as string).startsWith("api-intake/")).toBe(false);
  });

  it("extracts the token correctly on POST too", async () => {
    const req = new Request("https://project.supabase.co/api-intake/posttoken789", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date_of_birth: "1990-01-15" }),
    });
    const res = await capturedHandler?.(req);
    const body = await res?.json();

    expect(submitIntakeSpy).toHaveBeenCalledTimes(1);
    const tokenArg = submitIntakeSpy.mock.calls[0]?.[1];
    expect(tokenArg).toBe("posttoken789");
    expect(res?.status).toBe(200);
    expect(body).toEqual({ ok: true, receivedToken: "posttoken789" });
  });
});
