import { describe, expect, it, vi } from "vitest";

// QA-1 BE-04: APOLLO_API_KEY / OUTSCRAPER_API_KEY unset used to crash the
// isolate at module load. Now: platform-admin auth first (403), then a clean
// 503 not_configured naming the missing keys.
let capturedHandler: ((req: Request) => Response | Promise<Response>) | undefined;
const env = new Map<string, string>();

vi.stubGlobal("Deno", {
  serve: (handler: (req: Request) => Response | Promise<Response>) => {
    capturedHandler = handler;
  },
  env: { get: (name: string) => env.get(name) },
});

vi.mock("../_shared/deno/db.ts", () => ({ getSql: () => ({}) as unknown }));
const handleSpy = vi.fn(async () => ({ status: 200, body: { ok: true } }));
vi.mock("./handler.ts", () => ({ handleFetchLeads: () => handleSpy() }));

await import("./index.ts");

function jwt(claims: unknown): string {
  return `h.${btoa(JSON.stringify(claims))}.s`;
}

const call = (claims: unknown) =>
  capturedHandler?.(
    new Request("https://project.supabase.co/api-outreach-fetch-leads", {
      method: "POST",
      headers: { authorization: `Bearer ${jwt(claims)}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
  ) as Promise<Response>;

describe("api-outreach-fetch-leads entrypoint without provider keys", () => {
  it("still 403s a non-admin before anything else", async () => {
    expect((await call({ app_metadata: {} })).status).toBe(403);
  });

  it("403s aal2_required for an admin below aal2, before the provider keys are considered", async () => {
    const res = await call({ aal: "aal1", app_metadata: { platform_admin: true } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "aal2_required" });
  });

  it("answers 503 not_configured for an aal2 admin, naming the missing keys", async () => {
    const res = await call({ aal: "aal2", app_metadata: { platform_admin: true } });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "not_configured",
      missing: ["APOLLO_API_KEY", "OUTSCRAPER_API_KEY"],
    });
    expect(handleSpy).not.toHaveBeenCalled();
  });
});
