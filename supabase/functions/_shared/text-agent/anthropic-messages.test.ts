import { describe, expect, it, vi } from "vitest";
import {
  createMessagesWithTools,
  extractReplyText,
  extractToolUseBlocks,
} from "./anthropic-messages.ts";

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("createMessagesWithTools", () => {
  it("posts model/messages/tools and returns the parsed content on success", async () => {
    const fetchImpl = fakeFetch({
      content: [{ type: "text", text: "hello" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const result = await createMessagesWithTools(fetchImpl, "key", {
      model: "claude-sonnet-5",
      maxTokens: 100,
      system: "be helpful",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response.stop_reason).toBe("end_turn");
      expect(result.response.content).toEqual([{ type: "text", text: "hello" }]);
    }
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-api-key": "key" }),
      }),
    );
    const call = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    if (!call) throw new Error("fetchImpl was never called");
    const parsedBody = JSON.parse(call[1].body as string);
    expect(parsedBody.model).toBe("claude-sonnet-5");
    expect(parsedBody.system).toBe("be helpful");
  });

  it("omits the tools field when no tools are given", async () => {
    const fetchImpl = fakeFetch({
      content: [{ type: "text", text: "hi" }],
      stop_reason: "end_turn",
    });
    await createMessagesWithTools(fetchImpl, "key", {
      model: "m",
      maxTokens: 10,
      messages: [{ role: "user", content: "hi" }],
    });
    const call = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    if (!call) throw new Error("fetchImpl was never called");
    const parsedBody = JSON.parse(call[1].body as string);
    expect(parsedBody.tools).toBeUndefined();
  });

  it("returns ok:false with the status on a non-2xx response", async () => {
    const fetchImpl = fakeFetch({ error: "bad" }, 429);
    const result = await createMessagesWithTools(fetchImpl, "key", {
      model: "m",
      maxTokens: 10,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(429);
  });

  it("returns ok:false when fetch itself throws", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const result = await createMessagesWithTools(fetchImpl, "key", {
      model: "m",
      maxTokens: 10,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.ok).toBe(false);
  });
});

describe("extractReplyText", () => {
  it("concatenates every text block and trims", () => {
    const text = extractReplyText([
      { type: "text", text: "hello " },
      { type: "tool_use", id: "1", name: "t", input: {} },
      { type: "text", text: "world" },
    ]);
    expect(text).toBe("hello \nworld");
  });
});

describe("extractToolUseBlocks", () => {
  it("returns only tool_use blocks", () => {
    const blocks = extractToolUseBlocks([
      { type: "text", text: "hi" },
      { type: "tool_use", id: "1", name: "check_availability", input: { a: 1 } },
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.name).toBe("check_availability");
  });
});
