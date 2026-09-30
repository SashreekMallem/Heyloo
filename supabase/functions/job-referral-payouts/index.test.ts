import { describe, expect, it, vi } from "vitest";

// QA-1 BE-04: with PAYPAL_CLIENT_ID/SECRET unset the job must still load and
// (after the cron-secret check) answer an explicit skipped/not_configured 200
// instead of crashing at module load (WORKER_ERROR 500 on every invocation).
let capturedHandler: ((req: Request) => Response | Promise<Response>) | undefined;
const env = new Map<string, string>([["CRON_INVOKE_SECRET", "cron-secret"]]);

vi.stubGlobal("Deno", {
  serve: (handler: (req: Request) => Response | Promise<Response>) => {
    capturedHandler = handler;
  },
  env: { get: (name: string) => env.get(name) },
});

const runSpy = vi.fn(async () => ({ paid: 0 }));
vi.mock("../_shared/deno/db.ts", () => ({ getSql: () => ({}) as unknown }));
vi.mock("./handler.ts", () => ({ runReferralPayouts: (...a: unknown[]) => runSpy(...(a as [])) }));

await import("./index.ts");

const call = (secret?: string) =>
  capturedHandler?.(
    new Request("https://project.supabase.co/job-referral-payouts", {
      method: "POST",
      headers: secret ? { "x-cron-secret": secret } : {},
    }),
  ) as Promise<Response>;

describe("job-referral-payouts entrypoint without PayPal credentials", () => {
  it("still rejects a missing/wrong cron secret with 401 first", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("wrong")).status).toBe(401);
  });

  it("answers 200 skipped not_configured and never runs payouts", async () => {
    const res = await call("cron-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      skipped: "not_configured",
      missing: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"],
    });
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("runs the payouts once both credentials exist", async () => {
    env.set("PAYPAL_CLIENT_ID", "id");
    env.set("PAYPAL_CLIENT_SECRET", "secret");
    const res = await call("cron-secret");
    expect(res.status).toBe(200);
    expect(runSpy).toHaveBeenCalledTimes(1);
  });
});
