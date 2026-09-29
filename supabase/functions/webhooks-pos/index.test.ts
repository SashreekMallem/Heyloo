import { describe, expect, it, vi } from "vitest";

// QA-1 BE-04: the entrypoint must load with NONE of the optional provider
// secrets set, and each provider branch must fail closed (503 not_configured)
// on its own missing secret without affecting the others. Same Deno-shim
// pattern as admin/index.test.ts.
let capturedHandler: ((req: Request) => Response | Promise<Response>) | undefined;
const env = new Map<string, string>();

vi.stubGlobal("Deno", {
  serve: (handler: (req: Request) => Response | Promise<Response>) => {
    capturedHandler = handler;
  },
  env: { get: (name: string) => env.get(name) },
});

vi.mock("../_shared/deno/db.ts", () => ({ getSql: () => ({}) as unknown }));

// Loading must not throw even though every provider secret is unset.
await import("./index.ts");

const post = (provider: string) =>
  capturedHandler?.(
    new Request(`https://project.supabase.co/webhooks-pos/${provider}`, {
      method: "POST",
      body: "{}",
    }),
  ) as Promise<Response>;

describe("webhooks-pos entrypoint with no provider secrets configured", () => {
  it("loads (no module-scope requireEnv) and registers a handler", () => {
    expect(capturedHandler).toBeDefined();
  });

  it("square answers 503 not_configured, never processes an unverified webhook", async () => {
    const res = await post("square");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "not_configured", provider: "square" });
  });

  it("shopmonkey answers 503 not_configured", async () => {
    const res = await post("shopmonkey");
    expect(res.status).toBe(503);
  });

  it("google_calendar does not depend on the other providers' secrets (401 for a missing channel id, not a crash)", async () => {
    const res = await post("google_calendar");
    expect(res.status).toBe(401);
  });

  it("an unimplemented provider is still a 501, not a 500", async () => {
    const res = await post("ezyvet");
    expect(res.status).toBe(501);
  });
});
