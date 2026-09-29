import { describe, expect, it } from "vitest";
import { publicCorsHeaders } from "./cors.ts";

describe("publicCorsHeaders", () => {
  it("echoes the request origin and allows the supabase-js invoke headers", () => {
    const h = publicCorsHeaders(
      new Request("https://x.supabase.co/functions/v1/api-intake/t", {
        method: "OPTIONS",
        headers: { origin: "https://heyloo-voice.vercel.app" },
      }),
    );
    expect(h["access-control-allow-origin"]).toBe("https://heyloo-voice.vercel.app");
    for (const name of ["authorization", "apikey", "content-type", "x-client-info"]) {
      expect(h["access-control-allow-headers"]).toContain(name);
    }
    expect(h["access-control-allow-methods"]).toContain("POST");
    expect(h["vary"]).toBe("origin");
  });

  it("falls back to * when there is no Origin header", () => {
    expect(publicCorsHeaders(new Request("https://x/f"))["access-control-allow-origin"]).toBe("*");
  });
});
