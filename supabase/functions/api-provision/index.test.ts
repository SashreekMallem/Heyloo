import { describe, expect, it, vi } from "vitest";

// QA-1 BE-23: the internal-secret gate of api-provision must use the
// constant-time comparison (like the api-admin-* functions), not `===`.
let capturedHandler: ((req: Request) => Response | Promise<Response>) | undefined;
const env = new Map<string, string>([
  ["RETELL_API_KEY", "retell"],
  ["VOICE_TOOLS_WEBHOOK_URL", "https://x.test/voice-tools"],
  ["RETELL_INBOUND_WEBHOOK_URL", "https://x.test/voice-inbound"],
  ["VOICE_EVENTS_WEBHOOK_URL", "https://x.test/voice-events"],
  ["PROVISION_INTERNAL_SECRET", "internal-secret"],
]);

vi.stubGlobal("Deno", {
  serve: (handler: (req: Request) => Response | Promise<Response>) => {
    capturedHandler = handler;
  },
  env: { get: (name: string) => env.get(name) },
});

const safeEqual = vi.fn((a: string, b: string) => a === b);
vi.mock("../_shared/crypto.ts", () => ({
  timingSafeEqual: (a: string, b: string) => safeEqual(a, b),
}));
vi.mock("../_shared/deno/db.ts", () => ({ getSql: () => ({}) as unknown }));
const republish = vi.fn(async () => ({ status: 200, body: { ok: true } }));
vi.mock("./handler.ts", () => ({
  republishTenantAgent: (...a: unknown[]) => republish(...(a as [])),
  runProvisioningSaga: vi.fn(),
}));

await import("./index.ts");

const call = (secret: string) =>
  capturedHandler?.(
    new Request("https://project.supabase.co/functions/v1/api-provision", {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify({ tenant_id: "t1", action: "republish" }),
    }),
  ) as Promise<Response>;

describe("api-provision internal secret", () => {
  it("compares the presented secret with the constant-time helper", async () => {
    await call("nope");
    expect(safeEqual).toHaveBeenCalledWith("nope", "internal-secret");
  });

  it("rejects a wrong secret and accepts the right one", async () => {
    expect((await call("wrong")).status).toBe(403);
    expect(republish).not.toHaveBeenCalled();
    expect((await call("internal-secret")).status).toBe(200);
    expect(republish).toHaveBeenCalledTimes(1);
  });
});
