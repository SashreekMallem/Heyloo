import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_CALL_MARGIN_MS, DEMO_CALL_MAX_MS, demoCallLimitMs } from "./demo-call-limits";
import {
  DemoCallGrantError,
  type DemoWebClient,
  parseTranscriptUpdate,
  useDemoCall,
} from "./use-demo-call";

class FakeClient implements DemoWebClient {
  handlers = new Map<string, (payload?: unknown) => void>();
  startCall = vi.fn(async () => {
    this.emit("call_started");
  });
  stopCall = vi.fn();
  on(event: string, listener: (payload?: unknown) => void) {
    this.handlers.set(event, listener);
    return this;
  }
  emit(event: string, payload?: unknown) {
    this.handlers.get(event)?.(payload);
  }
}

function setMic(getUserMedia: (() => Promise<unknown>) | null) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: getUserMedia ? { getUserMedia } : undefined,
  });
}

const stream = { getTracks: () => [{ stop: vi.fn() }] };

function setup(overrides: { grant?: () => Promise<{ token: string; maxCallMs?: number }> } = {}) {
  const client = new FakeClient();
  const fetchGrant = vi.fn(overrides.grant ?? (async () => ({ token: "tok_1" })));
  const loadClient = vi.fn(async () => client);
  const hook = renderHook(() => useDemoCall({ fetchGrant, loadClient }));
  return { client, fetchGrant, loadClient, ...hook };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  setMic(async () => stream);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDemoCall: a normal call", () => {
  it("asks for the mic, then a token, then connects, then is live with the countdown running", async () => {
    const { result, client, fetchGrant } = setup();
    expect(result.current.phase).toBe("idle");
    expect(result.current.remainingMs).toBe(demoCallLimitMs());

    act(() => result.current.start());
    await settle();

    expect(fetchGrant).toHaveBeenCalledTimes(1);
    expect(client.startCall).toHaveBeenCalledWith({ accessToken: "tok_1" });
    expect(result.current.phase).toBe("live");

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current.remainingMs).toBeLessThanOrEqual(demoCallLimitMs() - 9_750);
    expect(result.current.remainingMs).toBeGreaterThan(demoCallLimitMs() - 10_500);
  });

  it("shows the live transcript from the SDK's update events, and who is talking", async () => {
    const { result, client } = setup();
    act(() => result.current.start());
    await settle();

    act(() =>
      client.emit("update", {
        transcript: [
          { role: "agent", content: "Thanks for calling. This is an AI assistant." },
          { role: "user", content: " Hi there " },
        ],
      }),
    );
    expect(result.current.transcript).toEqual([
      { role: "agent", text: "Thanks for calling. This is an AI assistant." },
      { role: "user", text: "Hi there" },
    ]);

    act(() => client.emit("agent_start_talking"));
    expect(result.current.agentTalking).toBe(true);
    act(() => client.emit("agent_stop_talking"));
    expect(result.current.agentTalking).toBe(false);

    act(() => client.emit("update", { nonsense: true }));
    expect(result.current.transcript).toHaveLength(2);
  });

  it("hangs up on its own at the hard time limit, and says so", async () => {
    const { result, client } = setup();
    act(() => result.current.start());
    await settle();

    await act(async () => {
      vi.advanceTimersByTime(demoCallLimitMs() + 500);
    });
    expect(result.current.phase).toBe("ended");
    expect(result.current.endReason).toBe("time-limit");
    expect(result.current.remainingMs).toBe(0);
    expect(client.stopCall).toHaveBeenCalled();
  });

  it("uses the server's ceiling when it sends one, minus the margin", async () => {
    const { result } = setup({ grant: async () => ({ token: "t", maxCallMs: 30_000 }) });
    act(() => result.current.start());
    await settle();
    expect(result.current.remainingMs).toBeLessThanOrEqual(30_000 - DEMO_CALL_MARGIN_MS);
    await act(async () => {
      vi.advanceTimersByTime(30_000 - DEMO_CALL_MARGIN_MS + 300);
    });
    expect(result.current.endReason).toBe("time-limit");
  });

  it("ends on the visitor's hang-up and on the far side hanging up", async () => {
    const first = setup();
    act(() => first.result.current.start());
    await settle();
    act(() => first.result.current.stop());
    expect(first.result.current.phase).toBe("ended");
    expect(first.result.current.endReason).toBe("hangup");
    expect(first.client.stopCall).toHaveBeenCalled();

    const second = setup();
    act(() => second.result.current.start());
    await settle();
    act(() => second.client.emit("call_ended"));
    expect(second.result.current.endReason).toBe("remote");
  });

  it("can talk again after a call ended", async () => {
    const { result, fetchGrant } = setup();
    act(() => result.current.start());
    await settle();
    act(() => result.current.stop());
    act(() => result.current.start());
    await settle();
    expect(fetchGrant).toHaveBeenCalledTimes(2);
    expect(result.current.phase).toBe("live");
    expect(result.current.transcript).toEqual([]);
  });

  it("stops the call when the component unmounts", async () => {
    const { result, client, unmount } = setup();
    act(() => result.current.start());
    await settle();
    unmount();
    expect(client.stopCall).toHaveBeenCalled();
  });

  it("ignores a second start while one is in flight", async () => {
    const { result, fetchGrant } = setup();
    act(() => {
      result.current.start();
      result.current.start();
    });
    await settle();
    expect(fetchGrant).toHaveBeenCalledTimes(1);
  });
});

describe("useDemoCall: graceful failure", () => {
  it("microphone blocked: no token is minted, no SDK is loaded", async () => {
    setMic(async () => {
      throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
    });
    const { result, fetchGrant, loadClient } = setup();
    act(() => result.current.start());
    await settle();
    expect(result.current.phase).toBe("error");
    expect(result.current.errorReason).toBe("mic-blocked");
    expect(fetchGrant).not.toHaveBeenCalled();
    expect(loadClient).not.toHaveBeenCalled();
  });

  it("no microphone device", async () => {
    setMic(async () => {
      throw Object.assign(new Error("none"), { name: "NotFoundError" });
    });
    const { result } = setup();
    act(() => result.current.start());
    await settle();
    expect(result.current.errorReason).toBe("no-mic");
  });

  it("browser without getUserMedia", async () => {
    setMic(null);
    const { result, fetchGrant } = setup();
    act(() => result.current.start());
    await settle();
    expect(result.current.errorReason).toBe("unsupported");
    expect(fetchGrant).not.toHaveBeenCalled();
  });

  it("rate limited by our own API", async () => {
    const { result, loadClient } = setup({
      grant: async () => {
        throw new DemoCallGrantError("rate-limited");
      },
    });
    act(() => result.current.start());
    await settle();
    expect(result.current.errorReason).toBe("rate-limited");
    expect(loadClient).not.toHaveBeenCalled();
  });

  it("token endpoint down", async () => {
    const { result } = setup({
      grant: async () => {
        throw new Error("network");
      },
    });
    act(() => result.current.start());
    await settle();
    expect(result.current.errorReason).toBe("unavailable");
  });

  it("SDK error event during the call", async () => {
    const { result, client } = setup();
    act(() => result.current.start());
    await settle();
    act(() => client.emit("error", "Error starting call"));
    expect(result.current.phase).toBe("error");
    expect(result.current.errorReason).toBe("failed");
    expect(client.stopCall).toHaveBeenCalled();
  });

  it("startCall rejecting", async () => {
    const { result, client } = setup();
    client.startCall.mockRejectedValueOnce(new Error("boom"));
    act(() => result.current.start());
    await settle();
    expect(result.current.errorReason).toBe("failed");
  });

  it("cancelling while connecting never starts the call", async () => {
    let release: (v: { token: string }) => void = () => {};
    const { result, client } = setup({
      grant: () => new Promise((resolve) => (release = resolve)),
    });
    act(() => result.current.start());
    await settle();
    expect(result.current.phase).toBe("connecting");
    act(() => result.current.stop());
    await act(async () => {
      release({ token: "late" });
    });
    await settle();
    expect(client.startCall).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("ended");
  });
});

describe("parseTranscriptUpdate", () => {
  it("keeps the documented shape and drops blank lines", () => {
    expect(
      parseTranscriptUpdate({
        transcript: [
          { role: "agent", content: "Hello" },
          { role: "user", content: "   " },
          { role: "user", content: "Hi" },
        ],
      }),
    ).toEqual([
      { role: "agent", text: "Hello" },
      { role: "user", text: "Hi" },
    ]);
  });

  it.each([null, undefined, "x", {}, { transcript: "no" }, { transcript: [{ role: 1 }] }])(
    "rejects %j",
    (payload) => {
      expect(parseTranscriptUpdate(payload)).toBeNull();
    },
  );
});

describe("demo call limits", () => {
  it("mirrors the two-minute server ceiling and ends the browser call a few seconds early", () => {
    expect(DEMO_CALL_MAX_MS).toBe(120_000);
    expect(demoCallLimitMs()).toBe(DEMO_CALL_MAX_MS - DEMO_CALL_MARGIN_MS);
    expect(demoCallLimitMs(0)).toBe(demoCallLimitMs());
    expect(demoCallLimitMs(5_000)).toBe(10_000);
  });
});
