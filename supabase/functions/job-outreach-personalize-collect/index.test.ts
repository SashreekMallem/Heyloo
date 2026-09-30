import { describe, expect, it, vi } from "vitest";

// QA-1 BE-04: OUTREACH_CAN_SPAM_FOOTER unset used to crash the isolate at
// module load every 15 minutes. It must still be fail-closed (nothing is
// prepared without the footer) but as an explicit skipped/not_configured 200
// after the cron-secret check.
let capturedHandler: ((req: Request) => Response | Promise<Response>) | undefined;
const env = new Map<string, string>([["CRON_INVOKE_SECRET", "cron-secret"]]);

vi.stubGlobal("Deno", {
  serve: (handler: (req: Request) => Response | Promise<Response>) => {
    capturedHandler = handler;
  },
  env: { get: (name: string) => env.get(name) },
});

const findSpy = vi.fn(async () => [] as string[]);
vi.mock("../_shared/deno/db.ts", () => ({ getSql: () => ({}) as unknown }));
vi.mock("../_shared/deno/llm.ts", () => ({
  resolveLlmFromEnv: () => ({ ok: true, client: {} }),
  resolveLlmForBatchFromEnv: () => ({ ok: true, client: {} }),
}));
vi.mock("./handler.ts", () => ({
  collectResearchBatch: vi.fn(),
  findInFlightResearchBatchIds: () => findSpy(),
}));

await import("./index.ts");

const call = (secret?: string) =>
  capturedHandler?.(
    new Request("https://project.supabase.co/job-outreach-personalize-collect", {
      method: "POST",
      headers: secret ? { "x-cron-secret": secret } : {},
    }),
  ) as Promise<Response>;

describe("job-outreach-personalize-collect entrypoint without the CAN-SPAM footer", () => {
  it("loads, and rejects a bad cron secret with 401", async () => {
    expect((await call("nope")).status).toBe(401);
  });

  it("skips (200 not_configured, naming the var) instead of crashing, and does no work", async () => {
    env.set("SMARTLEAD_API_KEY", "k");
    const res = await call("cron-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      skipped: "not_configured",
      missing: ["OUTREACH_CAN_SPAM_FOOTER"],
    });
    expect(findSpy).not.toHaveBeenCalled();
  });

  it("proceeds once the footer is set", async () => {
    env.set("OUTREACH_CAN_SPAM_FOOTER", "Heyloo, 1 Main St");
    const res = await call("cron-secret");
    expect(res.status).toBe(200);
    expect(findSpy).toHaveBeenCalledTimes(1);
  });
});
