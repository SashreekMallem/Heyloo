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
  it("POSTs the picked business type to our own API and returns the token, the ceiling and the phone", async () => {
    const fetchMock = stubFetch(async () =>
      Response.json({
        retell_call_token: "tok",
        max_call_ms: 30000,
        demo_phone_e164: "+15125550100",
      }),
    );
    await expect(fetchInstantDemoGrant("dental")).resolves.toEqual({
      token: "tok",
      maxCallMs: 30000,
      demoPhone: "+15125550100",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/demo/instant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vertical: "dental" }),
    });
  });

  it("sends the vertical id exactly, for every kind of business", async () => {
    const fetchMock = stubFetch(async () => Response.json({ retell_call_token: "tok" }));
    await fetchInstantDemoGrant("real_estate");
    await fetchInstantDemoGrant("generic");
    const bodies = fetchMock.mock.calls.map((call) => {
      const init = (call as unknown as [string, RequestInit])[1];
      return JSON.parse(init.body as string);
    });
    expect(bodies).toEqual([{ vertical: "real_estate" }, { vertical: "generic" }]);
  });

  it("works when the server sends no demo phone", async () => {
    stubFetch(async () => Response.json({ retell_call_token: "tok", max_call_ms: 30000 }));
    await expect(fetchInstantDemoGrant("auto")).resolves.toEqual({
      token: "tok",
      maxCallMs: 30000,
    });
  });

  it("maps a 429 to rate-limited", async () => {
    stubFetch(async () => Response.json({ error: "rate_limited" }, { status: 429 }));
    await expect(fetchInstantDemoGrant("auto")).rejects.toMatchObject({ reason: "rate-limited" });
  });

  it("maps a 503 demo_unavailable to business-unavailable (that kind of business has no agent yet)", async () => {
    stubFetch(async () => Response.json({ error: "demo_unavailable" }, { status: 503 }));
    await expect(fetchInstantDemoGrant("vet")).rejects.toMatchObject({
      reason: "business-unavailable",
    });
  });

  it.each([
    [
      "a 503 that is not demo_unavailable",
      () => Promise.resolve(Response.json({ error: "demo_error" }, { status: 503 })),
    ],
    ["a 503 with no JSON", () => Promise.resolve(new Response("down", { status: 503 }))],
    ["a server error", () => Promise.resolve(Response.json({}, { status: 502 }))],
    ["a network failure", () => Promise.reject(new Error("offline"))],
    ["a body that is not JSON", () => Promise.resolve(new Response("nope", { status: 200 }))],
    ["a body without a token", () => Promise.resolve(Response.json({ retell_call_token: "" }))],
  ])("maps %s to unavailable", async (_name, impl) => {
    stubFetch(impl);
    const error = await fetchInstantDemoGrant("auto").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DemoCallGrantError);
    expect(error).toMatchObject({ reason: "unavailable" });
  });
});
