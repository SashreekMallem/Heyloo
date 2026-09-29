import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callEdgeFunction = vi.fn();
vi.mock("@/lib/edge-functions", () => ({ callEdgeFunction }));

const { POST } = await import("./route");
const { demoInstantGlobalLimiter, demoInstantIpLimiter } = await import("@/lib/demo/rate-limit");

let ipCounter = 0;
function freshIp(): string {
  ipCounter += 1;
  return `10.0.0.${ipCounter}`;
}

function req(init: { origin?: string | null; ip?: string; body?: string } = {}) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    host: "www.heyloo.example",
    "x-forwarded-for": init.ip ?? freshIp(),
  };
  if (init.origin !== null) headers["origin"] = init.origin ?? "https://www.heyloo.example";
  return new Request("https://www.heyloo.example/api/demo/instant", {
    method: "POST",
    headers,
    body: init.body ?? "{}",
  });
}

const goodEdgeReply = {
  status: 200,
  body: {
    demo_session_id: "d1",
    retell_call_token: "tok_123",
    demo_phone_e164: "+15125550100",
    agent_summary: { business_name: "Riverside Auto Repair" },
    max_call_ms: 30000,
  },
};

describe("POST /api/demo/instant", () => {
  beforeEach(() => {
    callEdgeFunction.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks the edge function for an instant demo and returns only token, phone and limit", async () => {
    callEdgeFunction.mockResolvedValueOnce(goodEdgeReply);
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      retell_call_token: "tok_123",
      demo_phone_e164: "+15125550100",
      max_call_ms: 30000,
    });
    expect(callEdgeFunction).toHaveBeenCalledWith("api-demo-agent", {
      method: "POST",
      body: { instant: true, vertical: "auto" },
      timeoutMs: 8000,
    });
  });

  it("passes the picked business type to the edge function", async () => {
    for (const vertical of [
      "auto",
      "dental",
      "vet",
      "legal",
      "real_estate",
      "motel",
      "restaurant",
      "generic",
    ]) {
      callEdgeFunction.mockResolvedValueOnce(goodEdgeReply);
      const res = await POST(req({ body: JSON.stringify({ vertical }) }));
      expect(res.status).toBe(200);
      expect(callEdgeFunction).toHaveBeenLastCalledWith("api-demo-agent", {
        method: "POST",
        body: { instant: true, vertical },
        timeoutMs: 8000,
      });
    }
  });

  it("treats an empty body as auto repair (builds before the picker)", async () => {
    callEdgeFunction.mockResolvedValueOnce(goodEdgeReply);
    const res = await POST(req({ body: "" }));
    expect(res.status).toBe(200);
    expect(callEdgeFunction).toHaveBeenLastCalledWith(
      "api-demo-agent",
      expect.objectContaining({ body: { instant: true, vertical: "auto" } }),
    );
  });

  it.each([
    ["an unknown business type", JSON.stringify({ vertical: "plumber" })],
    ["a tenant slug", JSON.stringify({ vertical: "demo-dental" })],
    ["a non-string type", JSON.stringify({ vertical: 3 })],
    ["a body that is not JSON", "vertical=dental"],
  ])(
    "400s %s without calling the edge function or spending the rate limit",
    async (_name, body) => {
      const globalSpy = vi.spyOn(demoInstantGlobalLimiter, "allow");
      const ipSpy = vi.spyOn(demoInstantIpLimiter, "allow");
      const res = await POST(req({ body }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
      expect(callEdgeFunction).not.toHaveBeenCalled();
      expect(globalSpy).not.toHaveBeenCalled();
      expect(ipSpy).not.toHaveBeenCalled();
    },
  );

  it("answers 503 demo_unavailable when that business type has no demo agent yet", async () => {
    callEdgeFunction.mockResolvedValueOnce({ status: 503, body: { error: "demo_unavailable" } });
    const res = await POST(req({ body: JSON.stringify({ vertical: "motel" }) }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "demo_unavailable" });
  });

  it("works when the edge function sends no demo phone", async () => {
    callEdgeFunction.mockResolvedValueOnce({
      status: 200,
      body: { retell_call_token: "tok_123", max_call_ms: 30000 },
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ retell_call_token: "tok_123", max_call_ms: 30000 });
  });

  it("refuses a cross-site Origin without calling the edge function", async () => {
    const res = await POST(req({ origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(callEdgeFunction).not.toHaveBeenCalled();
  });

  it("accepts a same-site request with no Origin header (non-browser callers still hit the limits)", async () => {
    callEdgeFunction.mockResolvedValueOnce(goodEdgeReply);
    const res = await POST(req({ origin: null }));
    expect(res.status).toBe(200);
  });

  it("429s after 4 calls from one address, with Retry-After", async () => {
    callEdgeFunction.mockResolvedValue(goodEdgeReply);
    const ip = freshIp();
    for (let i = 0; i < 4; i++) expect((await POST(req({ ip }))).status).toBe(200);
    const blocked = await POST(req({ ip }));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("600");
    expect(await blocked.json()).toEqual({ error: "rate_limited" });
    expect(callEdgeFunction).toHaveBeenCalledTimes(4);
  });

  it("does not let one blocked address spend the global budget", async () => {
    callEdgeFunction.mockResolvedValue(goodEdgeReply);
    const allowSpy = vi.spyOn(demoInstantGlobalLimiter, "allow");
    const ip = freshIp();
    for (let i = 0; i < 4; i++) await POST(req({ ip }));
    allowSpy.mockClear();
    for (let i = 0; i < 5; i++) await POST(req({ ip }));
    expect(allowSpy).not.toHaveBeenCalled();
    allowSpy.mockRestore();
  });

  it("429s when the global hourly ceiling is spent", async () => {
    vi.spyOn(demoInstantGlobalLimiter, "allow").mockReturnValueOnce(false);
    const res = await POST(req());
    expect(res.status).toBe(429);
    expect(callEdgeFunction).not.toHaveBeenCalled();
  });

  it("502s when the edge function fails or answers with an unexpected shape", async () => {
    callEdgeFunction.mockResolvedValueOnce({
      status: 502,
      body: { error: "call_token_unavailable" },
    });
    const failed = await POST(req());
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: "demo_error" });
    callEdgeFunction.mockResolvedValueOnce({ status: 200, body: { retell_call_token: "" } });
    expect((await POST(req())).status).toBe(502);
    // an edge 503 that is NOT "that business has no agent" is a plain failure
    callEdgeFunction.mockResolvedValueOnce({ status: 503, body: { error: "not_configured" } });
    const other = await POST(req());
    expect(other.status).toBe(502);
    expect(await other.json()).toEqual({ error: "demo_error" });
  });

  it("503s (not demo_unavailable) when the edge function is unreachable", async () => {
    callEdgeFunction.mockRejectedValueOnce(new Error("network"));
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "demo_error" });
  });
});
