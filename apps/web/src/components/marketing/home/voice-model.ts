import { CALL_LINES, CALL_SECONDS } from "@/content/marketing/home";

/**
 * The voice model both the server markup (the recording waveform) and the
 * motion runtime (captions, level meter, the 3D line) read. Pure functions,
 * no DOM, so the server can import it.
 */

export interface WordTiming {
  /** Seconds into the call when the word starts. */
  t: number;
  /** Seconds the word is "spoken" for. */
  d: number;
  /** Letters and digits in the word. */
  n: number;
  /** The word as written, punctuation included. */
  s: string;
}

export interface CallWord extends WordTiming {
  /** 0 = Ava, 1 = the caller. */
  spk: 0 | 1;
  /** Index of the utterance the word belongs to. */
  u: number;
}

export interface CallScript {
  duration: number;
  utterances: { i: number; spk: 0 | 1; t0: number; t1: number }[];
  words: CallWord[];
}

/** Peak energy per speaker: Ava carries the call, the caller is a little quieter. */
export const VOICE_GAIN: readonly [number, number] = [0.85, 0.68];

const clean = (s: string): string => s.replace(/[^\p{L}\p{N}]/gu, "");

/** Spreads an utterance's words over its time window, longer words and words before punctuation getting more time. */
export function wordTimes(text: string, t0: number, t1: number): WordTiming[] {
  const toks = text.trim().split(/\s+/);
  const weights = toks.map((s) => Math.max(3, clean(s).length) + (/[.,?!;]$/.test(s) ? 1.2 : 0));
  const sum = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  return toks.map((s, i) => {
    const d = ((t1 - t0) * (weights[i] ?? 0)) / sum;
    const word = { t: t0 + acc, d: d * 0.86, n: clean(s).length, s };
    acc += d;
    return word;
  });
}

let cached: CallScript | null = null;

/** The example call as timed words. Deterministic, so it is built once. */
export function buildCallScript(): CallScript {
  if (cached) return cached;
  const utterances = CALL_LINES.map((line, i) => ({
    i,
    spk: (line.speaker === "ava" ? 0 : 1) as 0 | 1,
    t0: line.t0,
    t1: line.t1,
  }));
  const words: CallWord[] = [];
  CALL_LINES.forEach((line, i) => {
    const spk = line.speaker === "ava" ? 0 : 1;
    for (const w of wordTimes(line.text, line.t0, line.t1)) words.push({ ...w, spk, u: i });
  });
  cached = { duration: CALL_SECONDS, utterances, words };
  return cached;
}

export const wordAmplitude = (w: Pick<CallWord, "spk" | "n">): number =>
  (VOICE_GAIN[w.spk] ?? 0.7) * (0.55 + (0.45 * Math.min(w.n, 9)) / 9);

/** Instantaneous voice energy at call time `t`, the loudest word wins. */
export function energyAt(t: number, words: readonly CallWord[]): number {
  let e = 0;
  for (const w of words) {
    const x = (t - w.t) / w.d;
    if (x > 0 && x < 1) {
      const s = Math.sin(Math.PI * x);
      const v = wordAmplitude(w) * s * s;
      if (v > e) e = v;
    }
  }
  return e;
}

/** `m:ss` for a whole number of seconds. */
export function clock(t: number): string {
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The example call's wall-clock time, `11:52:SS PM`. */
export function wallClock(t: number): string {
  return `11:52:${String(Math.floor(t)).padStart(2, "0")} PM`;
}

/** The recording waveform as one SVG path of 96 vertical bars on a 192 x 32 box. */
export function waveformPath(): string {
  const { words } = buildCallScript();
  let d = "";
  for (let i = 0; i < 96; i++) {
    const e = energyAt(((i + 0.5) / 96) * CALL_SECONDS, words);
    const h = 3 + 25 * e ** 0.85;
    const x = 1 + i * 2;
    d += `M${x} ${(16 - h / 2).toFixed(1)}V${(16 + h / 2).toFixed(1)}`;
  }
  return d;
}
