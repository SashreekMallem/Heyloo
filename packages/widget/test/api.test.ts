import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchConfig,
  fetchVoiceToken,
  isErrorResponse,
  mintSession,
  sendChatMessage,
} from "../src/api";

describe("widget api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetchConfig returns the parsed config on a 200", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ business_name: "Acme", modes: ["chat"] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchConfig("https://app.example/api/widget/config", "pk_123");
    expect(result).toEqual({ business_name: "Acme", modes: ["chat"] });
    expect(fetchMock).toHaveBeenCalledWith("https://app.example/api/widget/config?key=pk_123", {
      method: "GET",
    });
  });

  it("fetchConfig returns null on a non-2xx (fails closed, never throws)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    const result = await fetchConfig("https://app.example/api/widget/config", "pk_123");
    expect(result).toBeNull();
  });

  it("fetchConfig returns null on a network error rather than rejecting", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const result = await fetchConfig("https://app.example/api/widget/config", "pk_123");
    expect(result).toBeNull();
  });

  it("mintSession posts the widget_public_key and returns the token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ widget_token: "tok.sig", expires_at: "2026-01-01T00:00:00Z" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await mintSession("https://app.example/api/widget/session", "pk_123");
    expect(result?.widget_token).toBe("tok.sig");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ widget_public_key: "pk_123" });
  });

  it("fetchVoiceToken surfaces an error body instead of throwing on a 4xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: false, json: async () => ({ error: "invalid_widget_token" }) }),
    );
    const result = await fetchVoiceToken("https://app.example/api/widget/voice-token", "bad");
    expect(isErrorResponse(result)).toBe(true);
  });

  it("sendChatMessage includes conversation_token only when present", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ conversation_token: "c1", reply: "hi", sent: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await sendChatMessage("https://fn.example/api-text-chat", "wt", "hello", null);
    let body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ widget_token: "wt", message: "hello" });

    await sendChatMessage("https://fn.example/api-text-chat", "wt", "again", "c1");
    body = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ widget_token: "wt", message: "again", conversation_token: "c1" });
  });

  it("isErrorResponse distinguishes an error body from a success body", () => {
    expect(isErrorResponse({ error: "x" })).toBe(true);
    expect(isErrorResponse({ reply: "hi", sent: true, conversation_token: "c" })).toBe(false);
    expect(isErrorResponse(null)).toBe(false);
  });
});
