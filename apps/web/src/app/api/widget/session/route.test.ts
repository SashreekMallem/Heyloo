import { describe, expect, it, vi } from "vitest";

const resolveWidgetTenant = vi.fn();
const mintWidgetToken = vi.fn();
vi.mock("@/lib/widget/resolve-tenant", () => ({ resolveWidgetTenant }));
vi.mock("@/lib/widget/session-token", () => ({ mintWidgetToken }));

const { POST } = await import("./route");

function req(body: unknown, origin = "https://tenant-site.example") {
  return new Request("https://app.example/api/widget/session", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

describe("POST /api/widget/session", () => {
  it("422s on an invalid body", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(422);
  });

  it("400s on unparseable JSON", async () => {
    const res = await POST(
      new Request("https://app.example/api/widget/session", { method: "POST", body: "not json" }),
    );
    expect(res.status).toBe(400);
  });

  it("404s when resolveWidgetTenant rejects the key/origin", async () => {
    resolveWidgetTenant.mockResolvedValueOnce(null);
    const res = await POST(req({ widget_public_key: "pk_bad" }));
    expect(res.status).toBe(404);
  });

  it("mints and returns a widget_token on success", async () => {
    resolveWidgetTenant.mockResolvedValueOnce({
      tenantId: "t1",
      businessName: "Acme",
      settings: {},
    });
    mintWidgetToken.mockReturnValueOnce({ token: "tok.sig", expiresAt: "2026-01-01T00:15:00Z" });

    const res = await POST(req({ widget_public_key: "pk_1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      widget_token: "tok.sig",
      expires_at: "2026-01-01T00:15:00Z",
    });
    expect(mintWidgetToken).toHaveBeenCalledWith({
      tenantId: "t1",
      widgetPublicKey: "pk_1",
      origin: "https://tenant-site.example",
    });
  });

  it("rate-limits repeated requests from the same IP+key", async () => {
    resolveWidgetTenant.mockResolvedValue({ tenantId: "t1", businessName: "Acme", settings: {} });
    mintWidgetToken.mockReturnValue({ token: "tok.sig", expiresAt: "2026-01-01T00:15:00Z" });

    const makeReq = () =>
      new Request("https://app.example/api/widget/session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://tenant-site.example",
          "x-forwarded-for": "9.9.9.9",
        },
        body: JSON.stringify({ widget_public_key: "pk_rate_test" }),
      });

    let lastStatus = 200;
    for (let i = 0; i < 25; i++) {
      const res = await POST(makeReq());
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });

  it("responds to a CORS preflight OPTIONS request", async () => {
    const { OPTIONS } = await import("./route");
    const res = await OPTIONS(
      new Request("https://app.example/api/widget/session", {
        method: "OPTIONS",
        headers: { origin: "https://tenant-site.example" },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://tenant-site.example");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });
});
