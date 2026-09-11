import { describe, expect, it, vi } from "vitest";

const resolveWidgetTenant = vi.fn();
vi.mock("@/lib/widget/resolve-tenant", () => ({ resolveWidgetTenant }));
vi.mock("@/lib/env", () => ({
  env: { supabaseFunctionsUrl: "https://proj.supabase.co/functions/v1" },
}));

const { GET } = await import("./route");

describe("GET /api/widget/config", () => {
  it("404s when resolveWidgetTenant rejects the key/origin", async () => {
    resolveWidgetTenant.mockResolvedValueOnce(null);
    const res = await GET(
      new Request("https://app.example/api/widget/config?key=pk_bad", {
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("returns public-safe config and never leaks allowed_origins", async () => {
    resolveWidgetTenant.mockResolvedValueOnce({
      tenantId: "t1",
      businessName: "Acme Dental",
      settings: {
        allowed_origins: ["https://tenant-site.example"],
        accent: "#0ea5e9",
        position: "bottom-left",
        greeting: "Hi there!",
        modes: ["voice", "chat"],
      },
    });
    const res = await GET(
      new Request("https://app.example/api/widget/config?key=pk_1", {
        headers: { origin: "https://tenant-site.example" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      business_name: "Acme Dental",
      accent: "#0ea5e9",
      position: "bottom-left",
      greeting: "Hi there!",
      modes: ["voice", "chat"],
      session_endpoint: "https://app.example/api/widget/session",
      voice_token_endpoint: "https://app.example/api/widget/voice-token",
      chat_endpoint: "https://proj.supabase.co/functions/v1/api-text-chat",
      voice_runtime_url: "https://app.example/widget-voice.js",
    });
    expect(JSON.stringify(body)).not.toContain("allowed_origins");
    expect(res.headers.get("access-control-allow-origin")).toBe("https://tenant-site.example");
  });
});
