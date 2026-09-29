"use client";

import { useEffect, useRef } from "react";
import { TALK } from "@/content/marketing/talk";
import { Link } from "@/i18n/navigation";
import { formatPhoneDisplay } from "@/lib/settings/format";
import { fetchInstantDemoGrant } from "./fetch-instant-grant";
import {
  type DemoCallErrorReason,
  type DemoCallGrant,
  type DemoCallView,
  type DemoWebClient,
  useDemoCall,
} from "./use-demo-call";

const ERROR_COPY: Record<DemoCallErrorReason, string> = {
  "mic-blocked":
    "Microphone access is blocked. Allow it in your browser’s site settings and try again, or call the demo line.",
  "no-mic": "No microphone was found. Plug one in and try again, or call the demo line.",
  unsupported:
    "This browser can’t start a voice call from here. Call the demo line, or use the demo page.",
  "rate-limited":
    "A lot of people are talking to Heyloo right now. Try again in a few minutes, or call the demo line.",
  unavailable: "The live demo isn’t available right now. Call the demo line, or use the demo page.",
  failed: "The call didn’t connect. Try again, call the demo line, or use the demo page.",
};

function statusLine(view: DemoCallView): string {
  switch (view.phase) {
    case "idle":
      return "Ready when you are.";
    case "requesting-mic":
      return "Allow the microphone in your browser to start.";
    case "connecting":
      return "Connecting to Heyloo…";
    case "live":
      return view.agentTalking ? "Heyloo is speaking." : "Listening. Go ahead and talk.";
    case "ended":
      return view.endReason === "time-limit"
        ? "That’s the 2 minute limit. Thanks for talking to Heyloo."
        : "Call ended. Thanks for talking to Heyloo.";
    case "error":
      return view.errorReason ? ERROR_COPY[view.errorReason] : ERROR_COPY.failed;
  }
}

const CHIP: Record<DemoCallView["phase"], string> = {
  idle: "Ready",
  "requesting-mic": "Microphone",
  connecting: "Connecting",
  live: "Live",
  ended: "Ended",
  error: "Not connected",
};

function clockLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function MicIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect
        x="6"
        y="1.5"
        width="4"
        height="8"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export interface TalkLiveProps {
  /** The shared demo phone number (E.164), when one is configured. */
  demoPhone?: string | undefined;
  /** Test seams. */
  fetchGrant?: () => Promise<DemoCallGrant>;
  loadClient?: () => Promise<DemoWebClient>;
}

/**
 * "Talk to Heyloo now": starts a real browser voice call with the shared demo
 * agent. The AI + recording disclosure and the time limit are printed above
 * the button, so they are read before the microphone prompt appears. Any
 * failure (no mic, blocked, rate limit, no network) lands on a state that
 * still offers the phone line and the `/demo` page.
 */
export function TalkLive({ demoPhone, fetchGrant, loadClient }: TalkLiveProps) {
  const view = useDemoCall({
    fetchGrant: fetchGrant ?? fetchInstantDemoGrant,
    ...(loadClient ? { loadClient } : {}),
  });
  const { phase, transcript, remainingMs, start, stop } = view;
  const logRef = useRef<HTMLOListElement | null>(null);
  const lineCount = transcript.length;

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on every new line
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lineCount]);

  const busy = phase === "requesting-mic" || phase === "connecting";
  const canStart =
    phase === "idle" ||
    phase === "ended" ||
    (phase === "error" && view.errorReason !== "unsupported");
  const phoneDisplay = demoPhone ? formatPhoneDisplay(demoPhone) : "";
  const showLog = phase === "live" || (phase === "ended" && lineCount > 0);

  return (
    <div className="talk panel" data-phase={phase} data-testid="talk-live">
      <div className="tk-top">
        <p className="lbl">Demo line · Riverside Auto Repair</p>
        <span className="chip tk-chip">{CHIP[phase]}</span>
      </div>

      <p className="data tk-disc">{TALK.disclosure}</p>

      <div className="tk-main">
        <p className="tk-status" role="status" aria-live="polite">
          <i
            className="dot tk-dot"
            data-on={view.agentTalking ? "" : undefined}
            aria-hidden="true"
          />
          <span>{statusLine(view)}</span>
        </p>

        {phase === "live" ? (
          <p className="data tk-clock" data-testid="talk-clock">
            {clockLeft(remainingMs)} left
          </p>
        ) : null}

        {showLog ? (
          <ol
            className="tk-log"
            ref={logRef}
            role="log"
            aria-label="Live transcript"
            aria-live="polite"
          >
            {lineCount === 0 ? (
              <li className="tk-wait data">The transcript appears here as you talk.</li>
            ) : (
              transcript.map((line, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: an append-only transcript, lines never reorder
                <li key={i} data-role={line.role}>
                  <b className="who data">{line.role === "agent" ? "Heyloo" : "You"}</b>
                  <span>{line.text}</span>
                </li>
              ))
            )}
          </ol>
        ) : null}

        <div className="ctas">
          {canStart ? (
            <button type="button" className="btn btn-p" onClick={start}>
              <MicIcon />
              {phase === "idle" ? TALK.start : TALK.again}
            </button>
          ) : null}
          {busy ? (
            <>
              <button type="button" className="btn btn-p" disabled>
                <MicIcon />
                Connecting…
              </button>
              <button type="button" className="btn btn-s" onClick={stop}>
                Cancel
              </button>
            </>
          ) : null}
          {phase === "live" ? (
            <button type="button" className="btn btn-s" onClick={stop}>
              {TALK.end}
            </button>
          ) : null}
          {phase === "ended" ? (
            <Link className="btn btn-s" href="/signup" prefetch={false}>
              Get started
            </Link>
          ) : null}
        </div>
      </div>

      <div className="tk-fine">
        <p className="data">{TALK.limit}</p>
        <p className="data tk-alt">
          {phoneDisplay ? (
            <>
              {TALK.phoneLead} <a href={`tel:${demoPhone}`}>{phoneDisplay}</a>.{" "}
            </>
          ) : null}
          <Link href="/demo" prefetch={false}>
            {TALK.ownAgent}
          </Link>
        </p>
      </div>
    </div>
  );
}
