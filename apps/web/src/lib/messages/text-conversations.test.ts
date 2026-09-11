import { describe, expect, it } from "vitest";
import { parseThreadKey, statusLabel, webChatKey } from "./text-conversations";

describe("webChatKey / parseThreadKey", () => {
  it("round-trips a web-chat conversation id", () => {
    const key = webChatKey("conv-123");
    expect(key).toBe("wc:conv-123");
    expect(parseThreadKey(key)).toEqual({ kind: "web_chat", conversationId: "conv-123" });
  });

  it("treats anything without the wc: prefix as a phone number", () => {
    expect(parseThreadKey("+15551234567")).toEqual({ kind: "phone", phone: "+15551234567" });
  });
});

describe("statusLabel", () => {
  it("labels every status", () => {
    expect(statusLabel("open")).toBe("AI is replying");
    expect(statusLabel("human")).toBe("You're replying");
    expect(statusLabel("closed")).toBe("Closed");
  });
});
