import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "./timeout.ts";

describe("withTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with the promise's value when it settles before ms, and clears its timer", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");

    const result = withTimeout(Promise.resolve("value"), 1_000);

    await expect(result).resolves.toBe("value");
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with tool_call_timeout when the promise is still pending at ms", async () => {
    const pending = new Promise<string>(() => {
      // never settles — the race must be decided by the timer.
    });

    const assertion = expect(withTimeout(pending, 1_000)).rejects.toThrow("tool_call_timeout");
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });

  it("supports a custom timeout error factory", async () => {
    const pending = new Promise<string>(() => {});

    const assertion = expect(
      withTimeout(pending, 500, () => new Error("custom_timeout")),
    ).rejects.toThrow("custom_timeout");
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });

  it("leaves no dangling timer after the resolve branch settles", async () => {
    await withTimeout(Promise.resolve(1), 500);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no dangling timer after the reject branch settles", async () => {
    const rejecting = withTimeout(
      new Promise<never>((_resolve, reject) => reject(new Error("boom"))),
      500,
    );
    await expect(rejecting).rejects.toThrow("boom");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no dangling timer after the timeout branch fires", async () => {
    const pending = new Promise<string>(() => {});
    const assertion = expect(withTimeout(pending, 200)).rejects.toThrow("tool_call_timeout");
    await vi.advanceTimersByTimeAsync(200);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});
