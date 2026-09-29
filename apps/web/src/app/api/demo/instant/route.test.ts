import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callEdgeFunction = vi.fn();
vi.mock("@/lib/edge-functions", () => ({ callEdgeFunction }));

const { POST } = await import("./route");
const { demoInstantGlobalLimiter } = await import("@/lib/demo/rate-limit");

let ipCounter = 0;
function freshIp(): string {
  ipCounter += 1;
  return `10.0.0.${ipCounter}`;
}

function req(init: { origin?: string | null; ip?: string } = {}) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    host: "www.heyloo.example",
    "x-forwarded-for": init.ip ?? freshIp(),
  };
  if (init.origin !== null) headers["origin"] = init.origin ?? "https://www.heyloo.example";
  return new Request("https://www.heyloo.example/api/demo/instant", {
    method: "POST",
    headers,
    body: "{}",
  });
}

const goodEdgeReply = {
  status: 200,
  body: {
    demo_session_id: "d1",
    retell_call_token: "tok_123",
    demo_phone_e164: "+15125550100",
    agent_summary: { business_name: "Riverside Auto Repair" },
    max_call_ms: 120000,
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
      max_call_ms: 120000,
    });
    expect(callEdgeFunction).toHaveBeenCalledWith("api-demo-agent", {
      method: "POST",
      body: { instant: true },
      timeoutMs: 8000,
    });
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
    expect((await POST(req())).status).toBe(502);
    callEdgeFunction.mockResolvedValueOnce({ status: 200, body: { retell_call_token: "" } });
    expect((await POST(req())).status).toBe(502);
  });

  it("503s when the edge function is unreachable", async () => {
    callEdgeFunction.mockRejectedValueOnce(new Error("network"));
    expect((await POST(req())).status).toBe(503);
  });
});
