import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchInstantDemoGrant } from "./fetch-instant-grant";
import { DemoCallGrantError } from "./use-demo-call";

function stubFetch(impl: () => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchInstantDemoGrant", () => {
  it("POSTs to our own API and returns the token, the ceiling and the phone", async () => {
    const fetchMock = stubFetch(async () =>
      Response.json({
        retell_call_token: "tok",
        max_call_ms: 120000,
        demo_phone_e164: "+15125550100",
      }),
    );
    await expect(fetchInstantDemoGrant()).resolves.toEqual({
      token: "tok",
      maxCallMs: 120000,
      demoPhone: "+15125550100",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/demo/instant", { method: "POST" });
  });

  it("maps a 429 to rate-limited", async () => {
    stubFetch(async () => Response.json({ error: "rate_limited" }, { status: 429 }));
    await expect(fetchInstantDemoGrant()).rejects.toMatchObject({ reason: "rate-limited" });
  });

  it.each([
    ["a server error", () => Promise.resolve(Response.json({}, { status: 502 }))],
    ["a network failure", () => Promise.reject(new Error("offline"))],
    ["a body that is not JSON", () => Promise.resolve(new Response("nope", { status: 200 }))],
    ["a body without a token", () => Promise.resolve(Response.json({ retell_call_token: "" }))],
  ])("maps %s to unavailable", async (_name, impl) => {
    stubFetch(impl);
    const error = await fetchInstantDemoGrant().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DemoCallGrantError);
    expect(error).toMatchObject({ reason: "unavailable" });
  });
});
