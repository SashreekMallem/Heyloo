import { describe, expect, it, vi } from "vitest";

const verifyWidgetToken = vi.fn();
vi.mock("@/lib/widget/session-token", () => ({ verifyWidgetToken }));
vi.mock("@/lib/env", () => ({
  env: { supabaseFunctionsUrl: "https://proj.supabase.co/functions/v1" },
}));

const { POST } = await import("./route");

function req(body: unknown, origin = "https://tenant-site.example", ip = "1.1.1.1") {
  return new Request("https://app.example/api/widget/voice-token", {
    method: "POST",
    headers: { "content-type": "application/json", origin, "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

describe("POST /api/widget/voice-token", () => {
  it("422s on an invalid body", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(422);
  });

  it("401s on an expired widget_token", async () => {
    verifyWidgetToken.mockReturnValueOnce({ ok: false, reason: "expired" });
    const res = await POST(req({ widget_token: "x" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "expired_widget_token" });
  });

  it("403s on a bad-signature widget_token", async () => {
    verifyWidgetToken.mockReturnValueOnce({ ok: false, reason: "bad_signature" });
    const res = await POST(req({ widget_token: "x" }));
    expect(res.status).toBe(403);
  });

  it("403s when the request Origin doesn't match the token's own origin claim", async () => {
    verifyWidgetToken.mockReturnValueOnce({
      ok: true,
      payload: {
        tenant_id: "t1",
        widget_public_key: "pk",
        origin: "https://minted-for.example",
        exp: 9_999_999_999,
        iat: 0,
      },
    });
    const res = await POST(req({ widget_token: "x" }, "https://different-site.example"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "origin_mismatch" });
  });

  it("forwards the raw widget_token (never a bare tenant_id) to the edge function and proxies its response", async () => {
    verifyWidgetToken.mockReturnValueOnce({
      ok: true,
      payload: {
        tenant_id: "t1",
        widget_public_key: "pk",
        origin: "https://tenant-site.example",
        exp: 9_999_999_999,
        iat: 0,
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ access_token: "tok_abc", call_id: "call_abc" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(req({ widget_token: "the.real.token" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ access_token: "tok_abc", call_id: "call_abc" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://proj.supabase.co/functions/v1/api-widget-voice-token");
    expect(JSON.parse(init.body as string)).toEqual({ widget_token: "the.real.token" });
    vi.unstubAllGlobals();
  });

  it("503s when the edge function is unreachable", async () => {
    verifyWidgetToken.mockReturnValueOnce({
      ok: true,
      payload: {
        tenant_id: "t1",
        widget_public_key: "pk",
        origin: "https://tenant-site.example",
        exp: 9_999_999_999,
        iat: 0,
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const res = await POST(req({ widget_token: "x" }, "https://tenant-site.example", "2.2.2.2"));
    expect(res.status).toBe(503);
    vi.unstubAllGlobals();
  });

  it("rate-limits repeated requests from the same IP+tenant", async () => {
    verifyWidgetToken.mockReturnValue({
      ok: true,
      payload: {
        tenant_id: "t_rate_test",
        widget_public_key: "pk",
        origin: "https://tenant-site.example",
        exp: 9_999_999_999,
        iat: 0,
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, text: async () => "{}" }));

    let lastStatus = 200;
    for (let i = 0; i < 10; i++) {
      const res = await POST(req({ widget_token: "x" }, "https://tenant-site.example", "3.3.3.3"));
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
    vi.unstubAllGlobals();
  });
});
