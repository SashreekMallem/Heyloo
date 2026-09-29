"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { demoCallLimitMs } from "./demo-call-limits";
import type { DemoWebCall } from "./web-call";

/**
 * The browser side of a public demo call, shared by `/demo` (`DemoFlow`) and
 * the home page's "Talk to Heyloo" (`TalkLive`). It owns the whole state
 * machine (mic permission, token, connect, live, ended), the live transcript
 * and the hard time limit, so both surfaces behave the same way.
 *
 * The Retell web SDK is loaded on demand (never in a page's initial JS) and
 * only from this component folder, the same place the dashboard's test-call
 * and the widget's voice bridge load it (`retell-client-js-sdk` 3.x, whose
 * `RetellWebClient` keeps the 2.x `startCall` / event API). The `update` event
 * carries the live transcript; its payload is checked below rather than
 * trusted (docs/VERIFY.md SITE-3).
 */

export type DemoCallPhase = "idle" | "requesting-mic" | "connecting" | "live" | "ended" | "error";

export type DemoCallErrorReason =
  | "unsupported"
  | "mic-blocked"
  | "no-mic"
  | "rate-limited"
  | "unavailable"
  | "failed";

export type DemoCallEndReason = "hangup" | "time-limit" | "remote";

export interface TranscriptLine {
  role: "agent" | "user";
  text: string;
}

/** What the caller's `fetchGrant` returns: the web-call token and, when the server said so, its ceiling. */
export interface DemoCallGrant {
  token: string;
  maxCallMs?: number;
  demoPhone?: string;
  /** Transport, call id and ICE servers create-web-call returned, when the server forwarded them. */
  webCall?: DemoWebCall | undefined;
}

/** Thrown by `fetchGrant` to steer the error state. */
export class DemoCallGrantError extends Error {
  constructor(readonly reason: "rate-limited" | "unavailable") {
    super(reason);
    this.name = "DemoCallGrantError";
  }
}

/** The slice of the SDK client this hook uses. */
export interface DemoWebClient {
  on(event: string, listener: (payload?: unknown) => void): unknown;
  startCall(config: {
    accessToken: string;
    transport?: "gateway" | "livekit";
    callId?: string;
    iceServers?: NonNullable<DemoWebCall["iceServers"]>;
  }): Promise<void>;
  stopCall(): void;
}

export interface UseDemoCallOptions {
  fetchGrant: () => Promise<DemoCallGrant>;
  /** Test seam. Defaults to a dynamic import of the Retell web SDK. */
  loadClient?: () => Promise<DemoWebClient>;
}

export interface DemoCallView {
  phase: DemoCallPhase;
  errorReason: DemoCallErrorReason | null;
  endReason: DemoCallEndReason | null;
  transcript: TranscriptLine[];
  /** True while the agent is speaking (the SDK's `agent_start_talking` / `agent_stop_talking`). */
  agentTalking: boolean;
  /** Milliseconds left on the hard limit while live; the full limit before that. */
  remainingMs: number;
  start: () => void;
  stop: () => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Turns an `update` event payload into transcript lines. The documented shape
 * is `{ transcript: [{ role: "agent" | "user", content: string }] }`; anything
 * else is ignored. A hand-rolled guard rather than zod: this file ships in the
 * home page's initial chunk, where zod would be most of its size.
 */
export function parseTranscriptUpdate(payload: unknown): TranscriptLine[] | null {
  if (!isRecord(payload) || !Array.isArray(payload["transcript"])) return null;
  const lines: TranscriptLine[] = [];
  for (const entry of payload["transcript"] as unknown[]) {
    if (!isRecord(entry) || typeof entry["role"] !== "string") return null;
    if (typeof entry["content"] !== "string") return null;
    const text = entry["content"].trim();
    if (text) lines.push({ role: entry["role"] === "agent" ? "agent" : "user", text });
  }
  return lines;
}

async function loadRetellClient(): Promise<DemoWebClient> {
  const { RetellWebClient } = await import("retell-client-js-sdk");
  return new RetellWebClient() as unknown as DemoWebClient;
}

function micErrorReason(error: unknown): DemoCallErrorReason {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return "mic-blocked";
  }
  if (
    name === "NotFoundError" ||
    name === "OverconstrainedError" ||
    name === "DevicesNotFoundError"
  ) {
    return "no-mic";
  }
  return "failed";
}

export function useDemoCall({ fetchGrant, loadClient }: UseDemoCallOptions): DemoCallView {
  const [phase, setPhase] = useState<DemoCallPhase>("idle");
  const [errorReason, setErrorReason] = useState<DemoCallErrorReason | null>(null);
  const [endReason, setEndReason] = useState<DemoCallEndReason | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [agentTalking, setAgentTalking] = useState(false);
  const [remainingMs, setRemainingMs] = useState(demoCallLimitMs());

  const clientRef = useRef<DemoWebClient | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  const finishedRef = useRef(false);
  const fetchGrantRef = useRef(fetchGrant);
  const loadClientRef = useRef(loadClient);
  useEffect(() => {
    fetchGrantRef.current = fetchGrant;
    loadClientRef.current = loadClient;
  });

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const finish = useCallback(
    (reason: DemoCallEndReason) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      clearTimer();
      const client = clientRef.current;
      clientRef.current = null;
      try {
        client?.stopCall();
      } catch {
        // already gone
      }
      busyRef.current = false;
      if (!aliveRef.current) return;
      setAgentTalking(false);
      setEndReason(reason);
      setPhase("ended");
    },
    [clearTimer],
  );

  const fail = useCallback(
    (reason: DemoCallErrorReason) => {
      clearTimer();
      const client = clientRef.current;
      clientRef.current = null;
      try {
        client?.stopCall();
      } catch {
        // already gone
      }
      finishedRef.current = true;
      busyRef.current = false;
      if (!aliveRef.current) return;
      setAgentTalking(false);
      setErrorReason(reason);
      setPhase("error");
    },
    [clearTimer],
  );

  const start = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    finishedRef.current = false;
    setErrorReason(null);
    setEndReason(null);
    setTranscript([]);
    setAgentTalking(false);
    setRemainingMs(demoCallLimitMs());

    void (async () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        fail("unsupported");
        return;
      }
      setPhase("requesting-mic");
      try {
        // Ask for the microphone ourselves first: the permission prompt appears
        // on the click, a refusal is told apart from a network error, and no
        // token is minted (real money) for a visitor who says no.
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        for (const track of stream.getTracks()) track.stop();
      } catch (error) {
        if (!finishedRef.current) fail(micErrorReason(error));
        return;
      }
      // `stop()` or an unmount while a step was in flight: do not go on.
      if (!aliveRef.current || finishedRef.current) return;

      setPhase("connecting");
      let grant: DemoCallGrant;
      try {
        grant = await fetchGrantRef.current();
      } catch (error) {
        if (finishedRef.current) return;
        fail(error instanceof DemoCallGrantError ? error.reason : "unavailable");
        return;
      }
      if (!aliveRef.current || finishedRef.current) return;

      const limitMs = demoCallLimitMs(grant.maxCallMs);
      setRemainingMs(limitMs);
      try {
        const client = await (loadClientRef.current ?? loadRetellClient)();
        if (!aliveRef.current || finishedRef.current) return;
        clientRef.current = client;
        client.on("call_started", () => {
          if (finishedRef.current || !aliveRef.current) return;
          const startedAt = Date.now();
          setPhase("live");
          clearTimer();
          timerRef.current = setInterval(() => {
            const left = limitMs - (Date.now() - startedAt);
            if (left <= 0) {
              setRemainingMs(0);
              finish("time-limit");
            } else {
              setRemainingMs(left);
            }
          }, 250);
        });
        client.on("call_ended", () => finish("remote"));
        client.on("error", () => fail("failed"));
        client.on("update", (payload) => {
          const lines = parseTranscriptUpdate(payload);
          if (lines && aliveRef.current) setTranscript(lines);
        });
        client.on("agent_start_talking", () => aliveRef.current && setAgentTalking(true));
        client.on("agent_stop_talking", () => aliveRef.current && setAgentTalking(false));
        const web = grant.webCall;
        await client.startCall({
          accessToken: grant.token,
          ...(web?.transport ? { transport: web.transport } : {}),
          ...(web?.callId ? { callId: web.callId } : {}),
          ...(web?.iceServers ? { iceServers: web.iceServers } : {}),
        });
        // Hung up while the connection was still being made: drop it now.
        if (finishedRef.current) client.stopCall();
      } catch {
        if (!finishedRef.current) fail("failed");
      }
    })();
  }, [clearTimer, fail, finish]);

  const stop = useCallback(() => finish("hangup"), [finish]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
      try {
        clientRef.current?.stopCall();
      } catch {
        // already gone
      }
      clientRef.current = null;
    };
  }, []);

  return { phase, errorReason, endReason, transcript, agentTalking, remainingMs, start, stop };
}
