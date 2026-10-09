/**
 * The live screen's alert sound (LIVE-1): a two-tone WebAudio chime (no
 * audio file, so nothing for the CSP's `media-src` to allow) that repeats
 * every 10 s while something still needs attention.
 *
 * Browsers start an `AudioContext` "suspended" until a user gesture
 * (https://developer.chrome.com/blog/autoplay), which is why the screen
 * opens behind a "Start live screen" button that creates/resumes it.
 */

export const CHIME_REPEAT_MS = 10_000;

/**
 * Whether the chime should be ringing: only after the screen was started
 * (audio unlocked), only with sound on, and only while something is still
 * unhandled: any order waiting in "received" (even one that was already
 * there when the screen loaded), or a booking / message that arrived since
 * the screen opened and nobody has acknowledged (see `pendingAlerts`).
 */
export function isAlerting(state: {
  started: boolean;
  soundOn: boolean;
  waitingOrders: number;
  unacknowledgedArrivals: number;
}): boolean {
  return (
    state.started && state.soundOn && (state.waitingOrders > 0 || state.unacknowledgedArrivals > 0)
  );
}

/**
 * Repeats `play` every `intervalMs` while alerting. Pure timing logic (the
 * sound itself is injected) so it is unit-tested with fake timers.
 */
export class ChimeScheduler {
  private handle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly play: () => void,
    private readonly intervalMs: number = CHIME_REPEAT_MS,
  ) {}

  get running(): boolean {
    return this.handle !== null;
  }

  /**
   * `alerting` false stops the repeat. A new `arrived` item while already
   * ringing plays at once and restarts the 10 s cycle, so a second order
   * is never silent for up to 10 s.
   */
  update(alerting: boolean, arrived = false): void {
    if (!alerting) {
      this.stop();
      return;
    }
    if (this.handle !== null && !arrived) return;
    this.stop();
    this.play();
    this.handle = setInterval(() => this.play(), this.intervalMs);
  }

  stop(): void {
    if (this.handle !== null) clearInterval(this.handle);
    this.handle = null;
  }
}

type AudioContextCtor = new () => AudioContext;

/** A new `AudioContext`, or null where Web Audio is unavailable (jsdom, very old browsers). */
export function createAudioContext(): AudioContext | null {
  // Older Safari only has the prefixed constructor.
  const g = globalThis as typeof globalThis & {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

/** Two short rising sine tones (A5 then E6), about 0.9 s in total. */
export function playChime(ctx: AudioContext, volume = 0.5): void {
  if (ctx.state !== "running") void ctx.resume().catch(() => undefined);
  const start = ctx.currentTime + 0.01;
  for (const [frequency, offset] of [
    [880, 0],
    [1318.5, 0.25],
  ] as const) {
    const at = start + offset;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency, at);
    // exponential ramps can't touch 0, so the envelope runs from/to 0.0001.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.65);
  }
}
