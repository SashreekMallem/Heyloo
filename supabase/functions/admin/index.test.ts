import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminRequestContext } from "./handler.ts";

// index.ts is a Deno entrypoint: it calls `Deno.serve(...)` at module scope
// and reads env vars via `Deno.env.get` (through `optionalEnv`). Neither
// exists under Node/Vitest, so we shim the minimal `Deno` surface it touches
// BEFORE importing it, capturing the request handler `Deno.serve` receives
// so we can drive it with a real `Request` — the only way to exercise the
// actual `url.pathname` -> `ctx.path` -> `routeAdminRequest` dispatch chain
// this repo's test suite otherwise skips entirely (handler.test.ts calls
// `routeAdminRequest` directly with hand-built `ctx.path` strings).

let capturedHandler: ((req: Request) => Response | Promise<Response>) | undefined;

vi.stubGlobal("Deno", {
  serve: (handler: (req: Request) => Response | Promise<Response>) => {
    capturedHandler = handler;
  },
  env: { get: () => undefined },
});

vi.mock("../_shared/deno/db.ts", () => ({
  getSql: () => ({}) as unknown,
}));

const routeAdminRequestSpy = vi.fn(async (_sql: unknown, ctx: AdminRequestContext) => {
  const [first] = ctx.path.split("/").filter(Boolean);
  if (first !== "admin-cockpit") {
    return { status: 404, body: { error: "not_found" } };
  }
  return { status: 200, body: { ok: true, receivedPath: ctx.path } };
});

vi.mock("./handler.ts", () => ({
  routeAdminRequest: (...args: Parameters<typeof routeAdminRequestSpy>) =>
    routeAdminRequestSpy(...args),
}));

await import("./index.ts");

describe("admin function entrypoint — URL to ctx.path dispatch", () => {
  beforeEach(() => {
    routeAdminRequestSpy.mockClear();
  });

  it("strips the `/functions/v1/admin/` prefix so the cockpit route dispatches, not 404", async () => {
    expect(capturedHandler).toBeDefined();

    const req = new Request(
      "https://project.supabase.co/functions/v1/admin/admin-cockpit/waterfall",
      { method: "GET" },
    );
    const res = await capturedHandler?.(req);
    const body = await res?.json();

    expect(routeAdminRequestSpy).toHaveBeenCalledTimes(1);
    const ctxArg = routeAdminRequestSpy.mock.calls[0]?.[1] as AdminRequestContext;
    expect(ctxArg.path).toBe("admin-cockpit/waterfall");
    expect(res?.status).toBe(200);
    expect(body).toEqual({ ok: true, receivedPath: "admin-cockpit/waterfall" });
  });

  it("would 404 if the function-name segment were left in ctx.path (regression guard)", async () => {
    const req = new Request("https://project.supabase.co/functions/v1/admin/admin-tenants", {
      method: "GET",
    });
    const res = await capturedHandler?.(req);

    expect(routeAdminRequestSpy).toHaveBeenCalledTimes(1);
    const ctxArg = routeAdminRequestSpy.mock.calls[0]?.[1] as AdminRequestContext;
    expect(ctxArg.path).toBe("admin-tenants");
    expect(ctxArg.path.startsWith("admin/")).toBe(false);
    // The spy above only special-cases "admin-cockpit"; "admin-tenants"
    // falls through its own 404 branch — this asserts ctx.path resolved to
    // the correct bare segment ("admin-tenants"), not that the real handler
    // has an admin-tenants route (it does; see handler.ts's tenants group).
    expect(res?.status).toBe(404);
  });
});
