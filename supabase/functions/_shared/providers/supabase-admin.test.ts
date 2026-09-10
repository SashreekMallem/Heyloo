import { describe, expect, it } from "vitest";
import { generateMagicLink, getUserEmailById } from "./supabase-admin.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("generateMagicLink", () => {
  it("omits options entirely when no redirectTo is given (backward compatible)", async () => {
    let capturedBody: unknown;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return jsonResponse({ action_link: "https://x/verify", hashed_token: "tok" });
    }) as never;
    const result = await generateMagicLink(
      fetchImpl,
      "https://proj.supabase.co",
      "sr_key",
      "a@b.com",
    );
    expect(result).toEqual({
      ok: true,
      status: 200,
      actionLink: "https://x/verify",
      hashedToken: "tok",
    });
    expect(capturedBody).toEqual({ type: "magiclink", email: "a@b.com" });
  });

  it("forwards redirectTo as options.redirect_to when provided", async () => {
    let capturedBody: unknown;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return jsonResponse({ action_link: "https://x/verify" });
    }) as never;
    await generateMagicLink(
      fetchImpl,
      "https://proj.supabase.co",
      "sr_key",
      "a@b.com",
      "https://app.example.com/dashboard",
    );
    expect(capturedBody).toEqual({
      type: "magiclink",
      email: "a@b.com",
      options: { redirect_to: "https://app.example.com/dashboard" },
    });
  });

  it("returns ok:false with the status on a non-2xx response, never throwing", async () => {
    const fetchImpl = (async () => jsonResponse({ error: "bad" }, 400)) as never;
    const result = await generateMagicLink(
      fetchImpl,
      "https://proj.supabase.co",
      "sr_key",
      "a@b.com",
    );
    expect(result).toEqual({ ok: false, status: 400 });
  });
});

describe("getUserEmailById", () => {
  it("returns the user's email on success", async () => {
    const fetchImpl = (async () => jsonResponse({ email: "owner@example.com" })) as never;
    const result = await getUserEmailById(
      fetchImpl,
      "https://proj.supabase.co",
      "sr_key",
      "user_1",
    );
    expect(result).toBe("owner@example.com");
  });

  it("returns null on a non-ok response rather than throwing", async () => {
    const fetchImpl = (async () => jsonResponse({ error: "not_found" }, 404)) as never;
    const result = await getUserEmailById(
      fetchImpl,
      "https://proj.supabase.co",
      "sr_key",
      "user_1",
    );
    expect(result).toBeNull();
  });
});
