import type { gsap as GsapNamespace } from "gsap";
import type ScrollTriggerNamespace from "gsap/ScrollTrigger";
import type SplitTextClass from "gsap/SplitText";
import type Lenis from "lenis";
import { BUSINESS_NAME, CALL_SECONDS, TRADES } from "@/content/marketing/home";
import type { SceneController, SceneTokens } from "../scene/scene";
import { buildCallScript, clock, wallClock } from "../voice-model";
import { HOME_CLASSES } from "./html-classes";

/**
 * The home page's motion runtime (SITE-3, ported from the approved
 * prototype's page script). It works on the server-rendered DOM: 13 scroll
 * segments (7 chapters plus the 6 hand-overs) drive the chapter state machines
 * (hero status, the hours readout, the call captions and meters, the dashboard
 * focus, the business tabs, the setup steps), the 3D scene, and the kinetic
 * type. Every state machine is a pure function of the segment values, so the
 * page reads the same at any scroll position.
 *
 * Tiers: `html.rm` (reduced motion) never pins or times anything; `html.fx`
 * pins the chapters on a scroll runway, with `html.stage` (desktop) or
 * `html.flow` (phones, short windows) picking the layout. The classes are
 * set by the inline bootstrap and re-checked by `HomeMotion`.
 */

export interface RuntimeDeps {
  gsap: typeof GsapNamespace;
  ScrollTrigger: typeof ScrollTriggerNamespace;
  SplitText: typeof SplitTextClass;
  Lenis: typeof Lenis;
}

export interface HomePageHandle {
  destroy(): void;
}

interface Segments {
  [id: string]: number;
}

/** Test and QA hook, exposed as `window.HeylooPage`. */
export interface HeylooPageApi {
  version: 1;
  mode: "static" | "fx";
  readonly tier: "stage" | "flow";
  segments(): Segments;
  T(): number;
  clock(): number;
  yFor(id: string, p: number): number;
  yForLink(id: string, q: number): number;
  yForCall(t: number): number;
  goto(y: number): void;
}

declare global {
  interface Window {
    HeylooPage?: HeylooPageApi;
  }
}

const CALL_PRE = 0.04;
const CALL_POST = 0.085;
const HOURS = 168;
const DASH_FADE0 = 0.16;
const DASH_FADE1 = 0.3;
const DASH_FOCUS0 = 0.34;
const DASH_STEP = 0.165;
const TRADE_COUNT = TRADES.length;
const CH = ["hero", "hours", "call", "dash", "trades", "setup", "finale"] as const;
const SEG = [
  "hero",
  "hero>hours",
  "hours",
  "hours>call",
  "call",
  "call>dash",
  "dash",
  "dash>trades",
  "trades",
  "trades>setup",
  "setup",
  "setup>finale",
  "finale",
] as const;
const BEATS = [0, 16, 31, 42, 54, 58] as const;
const FOCUS = ["transcript", "recording", "summary", "booking"] as const;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const STATE_TEXT = { ringing: "Ringing", live: "Live", booked: "Booked" } as const;

/** Fallback theme colours (BRIEF 4.1) for a browser that cannot resolve `oklch()` on a canvas. */
const DEFAULT_TOKENS = {
  dark: {
    ground: "#0c0d10",
    surface: "#16171a",
    rule: "#313337",
    line: "#696c72",
    ink: "#f5f3f0",
    ink2: "#a8abb0",
    filament: "#e0edf6",
    ember: "#edbb6a",
  },
  light: {
    ground: "#f8f5f1",
    surface: "#fefdfb",
    rule: "#d6d4cf",
    line: "#83868c",
    ink: "#121417",
    ink2: "#505358",
    filament: "#1c1f25",
    ember: "#ad721c",
  },
} as const;

const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

const $ = <T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document) =>
  root.querySelector<T>(selector);
const $$ = <T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll<T>(selector));
/** A page element the runtime cannot work without; throwing here sends the page back to its static layout. */
function must<T extends HTMLElement = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`home runtime: missing ${selector}`);
  return el;
}

const callP = (t: number): number =>
  CALL_PRE + (1 - CALL_PRE - CALL_POST) * clamp(t / CALL_SECONDS, 0, 1);

/**
 * Starts the home page runtime. `deps` is the motion libraries, or `null` for
 * reduced motion (which needs none of them: no pinning, no scrubbing, no
 * smooth scroll). Throws when the page markup is not the home page.
 */
export function runHomePage(deps: RuntimeDeps | null): HomePageHandle {
  const W = window;
  const D = document;
  const H = D.documentElement;
  const disposers: (() => void)[] = [];
  const on = <K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    listener: (event: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ) => {
    target.addEventListener(type, listener, options);
    disposers.push(() => target.removeEventListener(type, listener, options));
  };
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  };
  let destroyed = false;

  const fx = H.classList.contains(HOME_CLASSES.fx);
  const rm = H.classList.contains(HOME_CLASSES.rm);
  const mqStage = matchMedia("(min-width: 900px) and (min-height: 560px)");
  const mqFine = matchMedia("(hover: hover) and (pointer: fine)");
  const mqCoarse = matchMedia("(pointer: coarse)");
  const mqLight = matchMedia("(prefers-color-scheme: light)");
  let stageTier = mqStage.matches;
  const syncTier = () => {
    stageTier = mqStage.matches;
    H.classList.toggle(HOME_CLASSES.stage, stageTier);
    H.classList.toggle(HOME_CLASSES.flow, !stageTier);
  };
  syncTier();

  const shell = must(".hm-main").closest<HTMLElement>(".mk") ?? H;
  if (fx) {
    for (const sel of ["#readout", ".strip", "#hero-status", ".meter"]) {
      $(sel)?.setAttribute("aria-hidden", "true");
    }
  }
  const probe = must(".vh-probe");
  const mainEl = must(".hm-main");
  const foot = must("#foot");
  const chEl = CH.map((id) => must(`[data-ch="${id}"]`));
  const stages = $$("[data-ch] > .stage");
  const top: number[] = [];
  const hgt: number[] = [];
  let vh = W.innerHeight;
  let lenis: Lenis | null = null;
  let ctl: SceneController | null = null;
  let segs: Segments = {};
  const sent: Segments = {};
  for (const id of SEG) {
    segs[id] = 0;
    sent[id] = -1;
  }

  /* ---------- the call script, from the same content the markup renders ---------- */
  const script = buildCallScript();
  const { utterances, words } = script;

  /* ---------- measure ---------- */
  function measure() {
    vh = probe.getBoundingClientRect().height || W.innerHeight;
    if (fx) {
      for (const s of stages) {
        s.classList.remove("nostick");
        s.style.removeProperty("--stick-top");
        if (s.parentElement) s.parentElement.style.height = "";
      }
      for (const s of stages) {
        if (getComputedStyle(s).position === "sticky" && s.scrollHeight > vh + 2) {
          s.classList.add("nostick");
        }
      }
      /* a stage taller than the viewport scrolls its own overflow into view, then pins. The runway stays, so T never jumps. */
      for (const s of stages) {
        if (!s.classList.contains("nostick")) continue;
        const chp = s.parentElement;
        if (!chp) continue;
        const id = chp.getAttribute("data-ch");
        const run =
          Number.parseFloat(getComputedStyle(shell).getPropertyValue(`--run-${id}`)) || 200;
        const sh = Math.ceil(s.getBoundingClientRect().height);
        s.style.setProperty("--stick-top", `${Math.min(0, vh - sh)}px`);
        chp.style.height = `${Math.ceil(sh + (Math.max(run - 100, 40) / 100) * vh)}px`;
      }
    }
    const sy = W.pageYOffset || 0;
    chEl.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      top[i] = r.top + sy;
      hgt[i] = r.height;
    });
    const fr = foot.getBoundingClientRect();
    hgt[6] = fr.bottom + sy - (top[6] ?? 0);
  }
  const topOf = (i: number): number => top[i] ?? 0;
  const hgtOf = (i: number): number => hgt[i] ?? 0;
  /** A one-screen chapter still gets a real stretch of scroll. */
  function travelOf(i: number): number {
    const h = hgtOf(i);
    return Math.max(h - vh, i < 6 ? Math.min(0.6 * vh, h * 0.6) : 1, 1);
  }
  function computeSegs(y: number): Segments {
    const o: Segments = {};
    for (let i = 0; i < 7; i++) {
      const h = hgtOf(i);
      const t = topOf(i);
      const travel = travelOf(i);
      const id = CH[i] as string;
      o[id] = clamp((y - t) / travel, 0, 1);
      if (i < 6)
        o[`${id}>${CH[i + 1]}`] = clamp((y - (t + travel)) / Math.max(h - travel, 1), 0, 1);
    }
    return o;
  }
  const chIndex = (id: string): number => CH.indexOf(id as (typeof CH)[number]);
  const yFor = (id: string, p: number): number => topOf(chIndex(id)) + p * travelOf(chIndex(id));
  function yForLink(id: string, q: number): number {
    const i = chIndex(id.split(">")[0] ?? "");
    const travel = travelOf(i);
    return topOf(i) + travel + q * Math.max(hgtOf(i) - travel, 1);
  }
  const Tsum = (): number => SEG.reduce((t, id) => t + (segs[id] ?? 0), 0);

  /* ---------- tokens (the theme colours the scene draws with) ---------- */
  const cv = D.createElement("canvas");
  cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const hex2 = (n: number): string => `0${n.toString(16)}`.slice(-2);
  function toHex(v: string): string | null {
    if (!v || !cx || !(W.CSS?.supports && CSS.supports("color", v))) return null;
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = "#000";
    cx.fillStyle = v;
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return `#${hex2(d[0] ?? 0)}${hex2(d[1] ?? 0)}${hex2(d[2] ?? 0)}`;
  }
  function lum(h: string): number {
    const c = [1, 3, 5].map((i) => {
      const v = Number.parseInt(h.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
  }
  function readTokens(): SceneTokens {
    const cs = getComputedStyle(shell);
    const th = H.getAttribute("data-theme");
    const light = th === "light" || (th !== "dark" && mqLight.matches);
    const fb = DEFAULT_TOKENS[light ? "light" : "dark"];
    const read = (name: string, fallback: string): string =>
      safe(() => toHex(cs.getPropertyValue(name).trim())) || fallback;
    const ground = read("--ground", fb.ground);
    return {
      ground,
      surface: read("--surface", fb.surface),
      rule: read("--rule", fb.rule),
      line: read("--line", fb.line),
      ink: read("--ink", fb.ink),
      ink2: read("--ink-2", fb.ink2),
      filament: read("--filament", fb.filament),
      ember: read("--ember", fb.ember),
      dark: lum(ground) < 0.5,
    };
  }

  /* ---------- caption builder ---------- */
  const capzone = must(".capzone");
  const caps: HTMLElement[] = [];
  const capWords: { el: HTMLElement; t: number; on: boolean }[][] = [];
  utterances.forEach((u) => {
    const el = D.createElement("div");
    el.className = `cap ${u.spk ? "caller" : "ava"}`;
    el.setAttribute("data-s", "next");
    const cl = D.createElement("p");
    cl.className = "cl lbl";
    const who = D.createElement("span");
    who.className = "who";
    who.textContent = u.spk ? "Caller" : "Ava";
    const ts = D.createElement("span");
    ts.className = "ts";
    ts.textContent = wallClock(u.t0);
    cl.append(who, ts);
    const cw = D.createElement("p");
    cw.className = "cw";
    const list: { el: HTMLElement; t: number; on: boolean }[] = [];
    const mine = words.filter((w) => w.u === u.i);
    mine.forEach((w, j) => {
      const s = D.createElement("span");
      s.className = "w";
      s.setAttribute("data-state", "idle");
      s.textContent = w.s;
      cw.appendChild(s);
      if (j < mine.length - 1) cw.appendChild(D.createTextNode(" "));
      list.push({ el: s, t: w.t, on: false });
    });
    el.append(cl, cw);
    capzone.appendChild(el);
    caps.push(el);
    capWords.push(list);
  });
  disposers.push(() => {
    for (const el of caps) el.remove();
  });
  function measureCaptions() {
    if (!fx || getComputedStyle(capzone).display === "none") return;
    capzone.classList.add("measuring");
    const flat = capWords.flat();
    const saved = flat.map((w) => w.el.getAttribute("data-state") ?? "idle");
    for (const w of flat) w.el.style.width = "";
    for (const w of flat) w.el.setAttribute("data-state", "idle");
    const idle = flat.map((w) => w.el.getBoundingClientRect().width);
    for (const w of flat) w.el.setAttribute("data-state", "spoken");
    const spoken = flat.map((w) => w.el.getBoundingClientRect().width);
    flat.forEach((w, k) => {
      w.el.setAttribute("data-state", saved[k] ?? "idle");
      w.el.style.width = `${Math.ceil(Math.max(idle[k] ?? 0, spoken[k] ?? 0) * 10) / 10 + 0.5}px`;
    });
    void capzone.offsetWidth;
    capzone.classList.remove("measuring");
  }

  /* ---------- per-chapter state machines (pure functions of segment values) ---------- */
  const heroStatus = must("#hero-status");
  const heroStage = must(".st-hero");
  let heroOn: boolean | null = null;
  let lastBl = "";
  function updHero(p: number) {
    const bl = (1 - smooth(0.06, 0.5, p)).toFixed(2);
    if (bl !== lastBl) {
      lastBl = bl;
      heroStage.style.setProperty("--bl", bl);
    }
    const isOn = p >= 0.12;
    if (isOn !== heroOn) {
      heroOn = isOn;
      heroStatus.textContent = `${BUSINESS_NAME} · ${isOn ? "Answered · 0:00" : "Ringing"}`;
    }
  }

  const rdTime = must("#rd-time");
  const rdStat = must("#rd-stat");
  const rdTag = must("#rd-tag");
  let rdLast = "";
  function updHours(p: number) {
    let txt: string;
    let stat: string;
    let tag = false;
    if (p >= 0.985) {
      txt = "168 of 168 hours";
      stat = "Every hour of the week, answered";
    } else {
      const h = HOURS * p;
      const min = Math.floor((h * 60) / 5) * 5;
      const day = Math.min(6, Math.floor(min / 1440));
      const md = min - day * 1440;
      const hh = Math.floor(md / 60);
      const mm = md % 60;
      const ap = hh >= 12 ? "PM" : "AM";
      const h12 = hh % 12 === 0 ? 12 : hh % 12;
      txt = `${DAYS[day]} ${h12}:${`0${mm}`.slice(-2)} ${ap}`;
      const open = day < 5 && hh >= 8 && hh <= 17;
      stat = open ? "Open · Heyloo answers and transfers when needed" : "Closed · Heyloo answers";
      tag = Math.abs(h - 47.87) < 0.06;
    }
    const key = `${txt}|${stat}|${tag}`;
    if (key === rdLast) return;
    rdLast = key;
    rdTime.textContent = txt;
    rdStat.textContent = stat;
    rdTag.hidden = !tag;
  }

  const strip = must(".strip");
  const stLbl = $(".st-lbl");
  const stChip = must(".st-chip");
  const stT = must("#st-t");
  const tools = $$(".tools .chip");
  const sms = must(".sms");
  const stageCall = $("#call .stage") ?? must("#call");
  const lvWho = $("#lvl-who");
  let lastCo = -1;
  let lastLo = -1;
  let lastLv = "";
  let lastWho = "";
  const beatEls = $$(".beat");
  let curCap = -1;
  let capTimer: ReturnType<typeof setTimeout> | undefined;
  let lastState = "";
  let lastSec = -1;
  let lastBeat = -1;
  let lastSms = -1;
  let lastTools = "";
  const lastBp: number[] = [];
  function setCaption(i: number) {
    if (i === curCap) return;
    const prev = curCap;
    curCap = i;
    clearTimeout(capTimer);
    caps.forEach((el, k) => {
      let s: string;
      if (k === i) s = "cur";
      else if (k === prev) s = i > prev ? "old" : "next";
      else s = k < i ? "gone" : "next";
      el.setAttribute("data-s", s);
    });
    const was = caps[prev];
    if (prev >= 0 && i > prev && was) {
      capTimer = later(() => {
        if (was.getAttribute("data-s") === "old") was.setAttribute("data-s", "gone");
      }, 620);
    }
  }
  function updCall(p: number) {
    const raw = (CALL_SECONDS * (p - CALL_PRE)) / (1 - CALL_PRE - CALL_POST) + 1e-4;
    const c = clamp(raw, 0, CALL_SECONDS);
    const rc = Math.min(raw, CALL_SECONDS);
    const st = raw < 0 ? "ringing" : c >= 54 ? "booked" : "live";
    if (st !== lastState) {
      lastState = st;
      strip.setAttribute("data-state", st);
      stChip.textContent = STATE_TEXT[st];
      if (stLbl) stLbl.textContent = "Example call";
    }
    const sec = Math.floor(c);
    if (sec !== lastSec) {
      lastSec = sec;
      stT.textContent = clock(sec);
    }
    const tk = `${c >= 31 ? "a" : "x"}${c >= 54 ? "b" : "x"}`;
    if (tk !== lastTools) {
      lastTools = tk;
      for (const el of tools) {
        const at = Number(el.dataset["at"]);
        if (c >= at) el.removeAttribute("data-off");
        else el.setAttribute("data-off", "");
        el.removeAttribute("data-last");
      }
      const last = c >= 54 ? 2 : c >= 31 ? 0 : -1;
      if (last >= 0) tools[last]?.setAttribute("data-last", "");
    }
    const co = smooth(1 - CALL_POST + 0.012, 1 - 0.012, p);
    if (Math.abs(co - lastCo) > 0.004) {
      lastCo = co;
      stageCall.style.setProperty("--co", co.toFixed(3));
    }
    let e = 0;
    if (raw >= 0) {
      for (const ww of words) {
        const xx = (rc - ww.t) / ww.d;
        if (xx > 0 && xx < 1) {
          const sn = Math.sin(Math.PI * xx);
          const v = (ww.spk ? 0.68 : 0.85) * (0.55 + (0.45 * Math.min(ww.n, 9)) / 9) * sn * sn;
          if (v > e) e = v;
        }
      }
    }
    const lv = (Math.round(clamp(e / 0.85, 0, 1) * 40) / 40).toFixed(3);
    if (lv !== lastLv) {
      lastLv = lv;
      strip.style.setProperty("--lv", lv);
    }
    const so = smooth(54, 56, c);
    if (Math.abs(so - lastSms) > 0.004) {
      lastSms = so;
      sms.style.setProperty("--sms-o", so.toFixed(3));
    }
    const bi = c < 16 ? 0 : c < 31 ? 1 : c < 42 ? 2 : c < 54 ? 3 : 4;
    if (bi !== lastBeat) {
      lastBeat = bi;
      beatEls.forEach((el, i) => {
        el.setAttribute("data-s", i === bi ? "on" : i < bi ? "past" : "future");
      });
    }
    beatEls.forEach((el, i) => {
      const from = BEATS[i] ?? 0;
      const to = BEATS[i + 1] ?? CALL_SECONDS;
      let f = raw < 0 ? 0 : clamp((c - from) / (to - from), 0, 1);
      f = Math.round(f * 200) / 200;
      if (lastBp[i] !== f) {
        lastBp[i] = f;
        el.style.setProperty("--bp", String(f));
      }
    });
    let ui = 0;
    for (let i = 0; i < utterances.length; i++) {
      const u = utterances[i];
      if (u && u.t0 <= c && raw >= 0) ui = i;
    }
    setCaption(ui);
    const who = raw < 0 ? "" : utterances[ui]?.spk ? "Caller" : "Ava";
    if (lvWho && who !== lastWho) {
      lastWho = who;
      lvWho.textContent = who || "Ringing";
    }
    for (const list of capWords) {
      for (const w of list) {
        const isOn = raw >= 0 && rc >= w.t;
        if (isOn !== w.on) {
          w.on = isOn;
          w.el.setAttribute("data-state", isOn ? "spoken" : "idle");
        }
      }
    }
  }

  const dashEl = must(".dash");
  const wordEls = $$(".word");
  let lastFocus = -1;
  let lastDashO = "";
  let lastWv = "";
  function updDash(p: number) {
    if (!stageTier) {
      if (lastDashO !== "") {
        dashEl.style.removeProperty("--dash-o");
        dashEl.style.removeProperty("--wv");
        lastDashO = "";
        lastWv = "";
      }
      return;
    }
    const fi = p < DASH_FOCUS0 ? 0 : clamp(Math.floor((p - DASH_FOCUS0) / DASH_STEP), 0, 3);
    if (fi !== lastFocus) {
      lastFocus = fi;
      dashEl.setAttribute("data-focus", FOCUS[fi] ?? "booking");
      wordEls.forEach((el, i) => {
        el.classList.toggle("on", i === fi);
      });
    }
    const o = H.classList.contains(HOME_CLASSES.glOn)
      ? smooth(DASH_FADE0, DASH_FADE1, p).toFixed(3)
      : "1";
    if (o !== lastDashO) {
      lastDashO = o;
      if (o === "1") dashEl.style.removeProperty("--dash-o");
      else dashEl.style.setProperty("--dash-o", o);
    }
    const wv = clamp((p - 0.505) / 0.095, 0, 1).toFixed(3);
    if (wv !== lastWv) {
      lastWv = wv;
      dashEl.style.setProperty("--wv", wv);
    }
  }

  /* the dashboard frame arrives as a plane yawed a few degrees and eases flat while it is read (the 3D plate uses the same angle) */
  const glCanvas = must<HTMLCanvasElement>("#gl");
  let dashTiltOn = false;
  let lastDt = "";
  function updDashTilt() {
    const isOn = fx && stageTier && H.classList.contains(HOME_CLASSES.glOn);
    if (!isOn) {
      if (dashTiltOn) {
        dashTiltOn = false;
        lastDt = "";
        dashEl.style.removeProperty("--dt");
        dashEl.style.removeProperty("--dp");
      }
      return;
    }
    const T = Tsum();
    const deg = 6 * (1 - smooth(5.6, 6.9, T));
    const ch = glCanvas.clientHeight || W.innerHeight;
    const cw = glCanvas.clientWidth || W.innerWidth;
    const fm = 1 + 0.35 * smooth(1.4, 0.6, cw / ch);
    const P = ch / (2 * Math.tan((26 * fm * Math.PI) / 360));
    const k = `${deg.toFixed(2)}|${Math.round(P)}`;
    if (k === lastDt) return;
    lastDt = k;
    dashTiltOn = true;
    dashEl.style.setProperty("--dt", deg.toFixed(2));
    dashEl.style.setProperty("--dp", `${Math.round(P)}px`);
  }

  const tradeEls = $$(".trade");
  const tabEls = $$(".tabs a");
  const meterN = must("#meter-n");
  const meterB = must("#meter-b");
  let tIdx = -1;
  let tShown = -1;
  let lastMp = -1;
  function updTrades(p: number) {
    if (!stageTier) return;
    const want = clamp(Math.floor(p * TRADE_COUNT), 0, TRADE_COUNT - 1);
    if (tIdx < 0) tIdx = want;
    while (want > tIdx && p >= (tIdx + 1) / TRADE_COUNT + 0.015) tIdx++;
    while (want < tIdx && p < tIdx / TRADE_COUNT - 0.015) tIdx--;
    if (tIdx !== tShown) {
      tShown = tIdx;
      tradeEls.forEach((el, i) => {
        el.classList.toggle("on", i === tIdx);
      });
      tabEls.forEach((el, i) => {
        el.classList.toggle("on", i === tIdx);
        if (i === tIdx) el.setAttribute("aria-current", "true");
        else el.removeAttribute("aria-current");
      });
      meterN.textContent = `0${tIdx + 1} / 0${TRADE_COUNT}`;
    }
    const mp = Math.round(p * 500) / 500;
    if (mp !== lastMp) {
      lastMp = mp;
      meterB.style.setProperty("--mp", String(mp));
    }
  }

  const stepEls = $$(".step");
  const liveEl = must(".live");
  let lastStep = -1;
  function updSetup(p: number) {
    if (!stageTier) return;
    const n = (p >= 0.21 ? 1 : 0) + (p >= 0.52 ? 1 : 0) + (p >= 0.83 ? 1 : 0);
    if (n === lastStep) return;
    lastStep = n;
    stepEls.forEach((el, i) => {
      el.classList.toggle("on", i < n);
      el.classList.toggle("cur", i === n - 1);
    });
    liveEl.classList.toggle("on", n >= 3);
  }

  /* ---------- phones: keep the light off the copy (bands of the viewport where text sits right now) ---------- */
  let copyEls: HTMLElement[] | null = null;
  let copyKey = "";
  let copyWas = false;
  function updCopy() {
    if (!ctl) return;
    if (stageTier) {
      if (copyWas) {
        copyWas = false;
        copyKey = "";
        safe(() => ctl?.setCopyBands([], vh));
      }
      return;
    }
    copyEls ??= $$(
      "main h1, main h2, main h3, main p, main .ctas, main .strip, main .capzone, main .sms, main .legend, main .step .vign, main .figs figure, main .points li, main .pr-list li, main .beats, main .talk",
    );
    const height = glCanvas.clientHeight || W.innerHeight;
    const top0 = -20;
    const bot0 = height + 20;
    const bands: [number, number][] = [];
    for (const el of copyEls) {
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 6 || r.bottom < top0 || r.top > bot0) continue;
      if (getComputedStyle(el).visibility === "hidden") continue;
      bands.push([Math.max(0, r.top - 8), Math.min(height, r.bottom + 8)]);
    }
    bands.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const b of bands) {
      const l = merged[merged.length - 1];
      if (l && b[0] <= l[1] + 40) l[1] = Math.max(l[1], b[1]);
      else merged.push([b[0], b[1]]);
    }
    while (merged.length > 6) {
      let bi = 0;
      let bg = 1e9;
      for (let k = 0; k < merged.length - 1; k++) {
        const a = merged[k];
        const b = merged[k + 1];
        if (!a || !b) continue;
        const g = b[0] - a[1];
        if (g < bg) {
          bg = g;
          bi = k;
        }
      }
      const a = merged[bi];
      const b = merged[bi + 1];
      if (!a || !b) break;
      a[1] = b[1];
      merged.splice(bi + 1, 1);
    }
    const key = `${merged.map((b) => `${Math.round(b[0] / 3)}:${Math.round(b[1] / 3)}`).join("|")}@${height}`;
    if (key === copyKey) return;
    copyKey = key;
    copyWas = true;
    safe(() => ctl?.setCopyBands(merged, height));
  }

  /* ---------- driver ---------- */
  let hdrOn = false;
  function frame(y: number) {
    const s = computeSegs(y);
    segs = s;
    if (y > 8 !== hdrOn) {
      hdrOn = y > 8;
      H.classList.toggle(HOME_CLASSES.scrolled, hdrOn);
    }
    if (!fx) return;
    if (ctl) {
      for (const id of SEG) {
        const p = s[id] ?? 0;
        const d = Math.abs(p - (sent[id] ?? -1));
        if (d > 0.0005 || (d > 0 && (p === 0 || p === 1))) {
          sent[id] = p;
          ctl.setProgress(id, p);
        }
      }
    }
    const lo = smooth(0.02, 0.3, s["call>dash"] ?? 0);
    if (Math.abs(lo - lastLo) > 0.004) {
      lastLo = lo;
      stageCall.style.setProperty("--lo", lo.toFixed(3));
    }
    updHero(s["hero"] ?? 0);
    updHours(s["hours"] ?? 0);
    updCall(s["call"] ?? 0);
    updDash(s["dash"] ?? 0);
    updDashTilt();
    updTrades(s["trades"] ?? 0);
    updSetup(s["setup"] ?? 0);
    updCopy();
  }
  let rafQ = 0;
  const onNative = () => {
    if (rafQ) return;
    rafQ = requestAnimationFrame(() => {
      rafQ = 0;
      frame(W.pageYOffset || 0);
    });
  };
  const readY = (): number => (lenis ? lenis.scroll : W.pageYOffset || 0);
  disposers.push(() => cancelAnimationFrame(rafQ));

  /* ---------- Lenis (motion + fine pointer only) ---------- */
  const ease = (t: number): number => 1 - (1 - t) ** 4;
  if (fx && deps && mqFine.matches) {
    const { gsap: gs, ScrollTrigger: ST, Lenis: LenisClass } = deps;
    safe(() => {
      const l = new LenisClass({
        lerp: 0.1,
        smoothWheel: true,
        wheelMultiplier: 0.9,
        syncTouch: false,
      });
      lenis = l;
      l.on("scroll", () => {
        ST.update();
        frame(l.scroll);
      });
      const tick = (t: number) => l.raf(t * 1000);
      gs.ticker.add(tick);
      gs.ticker.lagSmoothing(0);
      disposers.push(() => {
        gs.ticker.remove(tick);
        l.destroy();
        lenis = null;
      });
    });
  }
  if (!lenis) on(W, "scroll", onNative, { passive: true });

  /* ---------- scene ---------- */
  let glOn = false;
  let sceneBooted = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let introGo: (() => void) | null = null;
  let sceneCoarse: boolean | null = null;
  const plateRect = () => {
    if (!fx || !stageTier) return null;
    const slot = must("#dash-slot");
    const st = slot.closest<HTMLElement>(".stage");
    if (!st) return null;
    const r = slot.getBoundingClientRect();
    const s = st.getBoundingClientRect();
    return { x: r.left, y: r.top - s.top, w: r.width, h: r.height };
  };
  const failScene = () => {
    H.classList.remove(HOME_CLASSES.glOn);
    H.classList.add(HOME_CLASSES.glOff);
    glOn = false;
  };
  let sceneModule: typeof import("../scene/scene") | null = null;
  function bootScene() {
    if (destroyed || sceneBooted || !sceneModule) return;
    sceneBooted = true;
    sceneCoarse = mqCoarse.matches || W.innerWidth < 900;
    const mod = sceneModule;
    const c = safe(() =>
      mod.mountScene(glCanvas, {
        reducedMotion: rm,
        coarse: sceneCoarse ?? false,
        theme: readTokens(),
        script,
        monoFamily:
          getComputedStyle(shell).getPropertyValue("--mono").trim() || "ui-monospace, monospace",
        onFirstFrame: () => {
          glOn = true;
          clearTimeout(watchdog);
          H.classList.remove(HOME_CLASSES.glOff);
          H.classList.add(HOME_CLASSES.glOn);
          introGo?.();
          if (fx) frame(readY());
        },
        onError: failScene,
      }),
    );
    if (!c) {
      H.classList.add(HOME_CLASSES.glOff);
      return;
    }
    ctl = c;
    c.resize();
    c.setPlateRect(plateRect());
    if (fx && W.IntersectionObserver) {
      /* on phones the thread and bead step aside while a button row is on screen */
      const ctaEls = $$("#pricing .ctas, #start .ctas, #talk .ctas");
      const inView = new Map<Element, boolean>();
      const io = new IntersectionObserver((es) => {
        for (const e of es) inView.set(e.target, e.isIntersecting);
        const any = [...inView.values()].some(Boolean);
        safe(() => c.setDim(any && !stageTier ? 0 : 1));
      });
      for (const el of ctaEls) io.observe(el);
      disposers.push(() => io.disconnect());
    }
    if (fx) {
      for (const id of SEG) {
        sent[id] = segs[id] ?? 0;
        c.setProgress(id, segs[id] ?? 0);
      }
    }
    clearTimeout(watchdog);
    watchdog = later(() => {
      if (!glOn) {
        safe(() => c.destroy());
        ctl = null;
        H.classList.remove(HOME_CLASSES.glOn);
        H.classList.add(HOME_CLASSES.glOff);
      }
    }, 6000);
  }
  function scheduleScene() {
    requestAnimationFrame(() => {
      const go = () => bootScene();
      if (W.requestIdleCallback) W.requestIdleCallback(go, { timeout: 200 });
      else later(go, 60);
    });
  }
  void import("../scene/scene").then((mod) => {
    if (destroyed) return;
    sceneModule = mod;
    scheduleScene();
  }, failScene);
  later(() => {
    if (!sceneBooted) H.classList.add(HOME_CLASSES.glOff);
  }, 8000);

  /* pointer (fine pointers, motion only) */
  if (fx && mqFine.matches) {
    let px = 0;
    let py = 0;
    let pq = 0;
    on(
      W,
      "pointermove",
      (e) => {
        if (e.pointerType && e.pointerType !== "mouse" && e.pointerType !== "pen") return;
        px = clamp((e.clientX / W.innerWidth) * 2 - 1, -1, 1);
        py = clamp((e.clientY / W.innerHeight) * 2 - 1, -1, 1);
        if (!pq) {
          pq = requestAnimationFrame(() => {
            pq = 0;
            ctl?.setPointer(px, py);
          });
        }
      },
      { passive: true },
    );
    const zero = () => {
      px = 0;
      py = 0;
      ctl?.setPointer(0, 0);
    };
    H.addEventListener("pointerleave", zero);
    disposers.push(() => H.removeEventListener("pointerleave", zero));
    on(W, "blur", zero);
    disposers.push(() => cancelAnimationFrame(pq));
  }
  const onVisibility = () => {
    if (!ctl) return;
    if (D.hidden) ctl.pause();
    else ctl.resume();
  };
  D.addEventListener("visibilitychange", onVisibility);
  disposers.push(() => D.removeEventListener("visibilitychange", onVisibility));

  /* theme bridge */
  let themeQ = 0;
  const themeChanged = () => {
    cancelAnimationFrame(themeQ);
    themeQ = requestAnimationFrame(() => ctl?.setTheme(readTokens()));
  };
  mqLight.addEventListener("change", themeChanged);
  disposers.push(() => mqLight.removeEventListener("change", themeChanged));
  const themeObserver = new MutationObserver(themeChanged);
  themeObserver.observe(H, { attributes: true, attributeFilter: ["data-theme"] });
  disposers.push(() => {
    themeObserver.disconnect();
    cancelAnimationFrame(themeQ);
  });

  /* ---------- type: split once, animate registered axes ---------- */
  interface KinWord {
    el: HTMLElement;
    rest: [number, number];
    w: number;
  }
  interface KinHeading extends HTMLElement {
    _kw?: HTMLElement[];
    _rest?: [number, number];
  }
  const kinWords: KinWord[] = [];
  const restOf = (el: HTMLElement): [number, number] => {
    const cs = getComputedStyle(el);
    return [
      Number.parseFloat(cs.getPropertyValue("--wg")) || 560,
      Number.parseFloat(cs.getPropertyValue("--wd")) || 106,
    ];
  };
  function lockWords() {
    if (!kinWords.length) return;
    for (const o of kinWords) {
      const el = o.el;
      const w0 = el.style.getPropertyValue("--wg");
      const d0 = el.style.getPropertyValue("--wd");
      el.style.width = "";
      el.style.setProperty("--wg", String(o.rest[0]));
      el.style.setProperty("--wd", String(o.rest[1]));
      o.w = el.getBoundingClientRect().width;
      if (w0 === "") el.style.removeProperty("--wg");
      else el.style.setProperty("--wg", w0);
      if (d0 === "") el.style.removeProperty("--wd");
      else el.style.setProperty("--wd", d0);
    }
    for (const o of kinWords) o.el.style.width = `${Math.ceil(o.w * 10) / 10 + 0.5}px`;
  }
  const heroChars: { line: HTMLElement; chars: HTMLElement[]; wg: number; wd: number }[] = [];
  const splits: { revert(): void }[] = [];
  function initType() {
    if (!fx || !deps) return;
    const { gsap: gs, ScrollTrigger: ST, SplitText: SP } = deps;
    gs.registerPlugin(SP, ST);
    ST.config({ ignoreMobileResize: true });
    /* hero characters */
    const h1 = must("#h1");
    h1.setAttribute("aria-label", (h1.textContent ?? "").replace(/\s+/g, " ").trim());
    for (const [selector, wg, wd] of [
      [".d1 .l1", 620, 110],
      [".d1 .l2", 320, 110],
    ] as const) {
      const line = must(selector);
      const sp = SP.create(line, { type: "chars", tag: "span", charsClass: "ch", aria: "none" });
      splits.push(sp);
      const chars = sp.chars as HTMLElement[];
      for (const c of chars) {
        c.classList.add("kx");
        c.setAttribute("aria-hidden", "true");
        /* like the headings' words: each character keeps its rest width, so the
           swell from thin to full weight happens inside the box and moves nothing */
        kinWords.push({ el: c, rest: [wg, wd], w: 0 });
      }
      heroChars.push({ line, chars, wg, wd });
    }
    /* section headings: words locked to their rest width */
    for (const h of $$<KinHeading>(".kin")) {
      h.setAttribute("aria-label", (h.textContent ?? "").replace(/\s+/g, " ").trim());
      const sp = SP.create(h, { type: "words", tag: "span", wordsClass: "kw", aria: "none" });
      splits.push(sp);
      const rest = restOf(h);
      const list = sp.words as HTMLElement[];
      for (const w of list) {
        w.classList.add("kx");
        w.setAttribute("aria-hidden", "true");
        kinWords.push({ el: w, rest, w: 0 });
      }
      h._kw = list;
      h._rest = rest;
    }
    lockWords();
  }
  let introDone = false;
  function startIntro() {
    if (!heroChars.length || introDone || !deps) return;
    const gs = deps.gsap;
    introDone = true;
    for (const d of heroChars) {
      gs.fromTo(
        d.chars,
        { "--wg": 200, "--wd": 75 },
        {
          "--wg": d.wg,
          "--wd": d.wd,
          duration: 1.8,
          ease: "expo.out",
          stagger: 0.035,
          onComplete: () => {
            for (const c of d.chars) {
              c.style.removeProperty("--wg");
              c.style.removeProperty("--wd");
            }
          },
        },
      );
    }
    H.classList.remove(HOME_CLASSES.introPre);
    gs.from(".hero-labels > *, .hero-body > *", {
      opacity: 0.35,
      y: 12,
      duration: 0.9,
      delay: 0.9,
      ease: "expo.out",
      clearProps: "opacity,transform",
      stagger: 0.06,
    });
  }
  let matchMedia_: { revert(): void } | null = null;
  function buildScrubs() {
    if (!fx || !deps) return;
    const { gsap: gs, ScrollTrigger: ST } = deps;
    const mm = gs.matchMedia();
    matchMedia_ = mm;
    mm.add(
      {
        desktop:
          "(min-width: 900px) and (min-height: 560px) and (prefers-reduced-motion: no-preference)",
        mobile:
          "(prefers-reduced-motion: no-preference) and (max-width: 899px), (prefers-reduced-motion: no-preference) and (max-height: 559px)",
        reduce: "(prefers-reduced-motion: reduce)",
      },
      (ctx) => {
        const cond = ctx.conditions ?? {};
        if (cond["reduce"]) return;
        const desk = !!cond["desktop"];
        /* hero exit: thins and widens like a voice trailing off, then fades (hero p 0.25 to 1) */
        if (heroChars.length) {
          const tr = () => travelOf(0);
          for (const [sel, wg, wd, wgEnd] of [
            [".d1 .l1", 620, 110, 240],
            [".d1 .l2", 320, 110, 200],
          ] as const) {
            gs.fromTo(
              sel,
              { "--wg": wg, "--wd": wd, scale: 1, opacity: 1, transformOrigin: "0% 60%" },
              {
                "--wg": wgEnd,
                "--wd": 125,
                scale: 1.06,
                opacity: 0,
                ease: "none",
                immediateRender: false,
                scrollTrigger: {
                  trigger: "#top",
                  start: () => `top+=${0.25 * tr()} top`,
                  end: () => `top+=${tr()} top`,
                  scrub: 0.8,
                  invalidateOnRefresh: true,
                },
              },
            );
          }
        }
        /* section headings */
        for (const h of $$<KinHeading>(".kin")) {
          if (!h._kw || !h._rest) continue;
          const chapter = h.closest<HTMLElement>("[data-ch]");
          const inRunway =
            chapter &&
            chapter.tagName === "SECTION" &&
            chapter.querySelector(":scope > .stage") &&
            (desk || chapter.id === "hours" || chapter.id === "call" || chapter.id === "top");
          const st = inRunway
            ? { trigger: chapter, start: "top 100%", end: "top 50%" }
            : { trigger: h, start: "top 100%", end: "top 62%" };
          gs.fromTo(
            h._kw,
            { "--wg": 320, "--wd": 92 },
            {
              "--wg": h._rest[0],
              "--wd": h._rest[1],
              stagger: 0.06,
              ease: "none",
              scrollTrigger: { ...st, scrub: 0.8 },
            },
          );
        }
        /* price numeral, once */
        gs.fromTo(
          "#pricing .num",
          { "--wg": 200, "--wd": 75 },
          {
            "--wg": 300,
            "--wd": 118,
            ease: "none",
            scrollTrigger: {
              trigger: "#pricing .num",
              start: "top 90%",
              end: "top 30%",
              scrub: 0.8,
            },
          },
        );
        /* underline strokes under the disclosure phrases */
        gs.fromTo(
          "#trust mark",
          { "--u": 0 },
          {
            "--u": 1,
            stagger: 0.2,
            ease: "none",
            scrollTrigger: { trigger: ".figs", start: "top 78%", end: "top 40%", scrub: 0.6 },
          },
        );
        /* footer wordmark width, last 80vh of the page */
        gs.fromTo(
          "#ft-mark",
          { "--wd": 75 },
          {
            "--wd": 125,
            ease: "none",
            scrollTrigger: {
              trigger: "#foot",
              start: () => Math.max(ST.maxScroll(W) - W.innerHeight * 0.8, 0),
              end: "max",
              scrub: 0.8,
              invalidateOnRefresh: true,
            },
          },
        );
        return () => {
          /* gsap.matchMedia reverts every tween and trigger created above */
        };
      },
    );
  }

  /* ---------- anchors ---------- */
  function scrollToY(y: number, immediate: boolean) {
    if (lenis) lenis.scrollTo(y, immediate ? { immediate: true } : { duration: 1.4, easing: ease });
    else W.scrollTo(0, y);
    if (immediate) frame(readY());
  }
  function targetForHash(id: string): number | null {
    const t = D.getElementById(id);
    if (!t) return null;
    const ti = tradeEls.indexOf(t);
    if (ti >= 0 && stageTier) return yFor("trades", (ti + 0.5) / TRADE_COUNT);
    if (id === "dashboard" && stageTier) return yFor("dash", 0.3);
    if (ti >= 0) return t.getBoundingClientRect().top + (W.pageYOffset || 0) - 88;
    return t.getBoundingClientRect().top + (W.pageYOffset || 0);
  }
  const onClick = (e: MouseEvent) => {
    const a = (e.target as Element | null)?.closest?.("a");
    if (!a || !fx || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    /* `#call` on the home page, or `/#call` from the shared header and footer */
    const href = a.getAttribute("href") ?? "";
    const hash = href.startsWith("#")
      ? href
      : (() => {
          try {
            const u = new URL(href, W.location.href);
            return u.origin === W.location.origin &&
              u.pathname.replace(/\/$/, "") === W.location.pathname.replace(/\/$/, "")
              ? u.hash
              : "";
          } catch {
            return "";
          }
        })();
    const id = hash.slice(1);
    if (!id) return;
    const y = targetForHash(id);
    if (y === null) return;
    e.preventDefault();
    scrollToY(y, false);
    const f = D.getElementById(id);
    if (f) {
      if (f.tabIndex < 0 && !f.hasAttribute("tabindex")) f.setAttribute("tabindex", "-1");
      safe(() => f.focus({ preventScroll: true }));
    }
  };
  D.addEventListener("click", onClick, true);
  disposers.push(() => D.removeEventListener("click", onClick, true));

  /* ---------- resize, fonts ---------- */
  let rz: ReturnType<typeof setTimeout> | undefined;
  function relayout() {
    measure();
    measureCaptions();
    lockWords();
    if (ctl) {
      ctl.resize();
      ctl.setPlateRect(plateRect());
    }
    if (fx) deps?.ScrollTrigger.refresh();
    frame(readY());
  }
  const queueRelayout = () => {
    clearTimeout(rz);
    rz = later(relayout, 120);
  };
  on(W, "resize", queueRelayout);
  if (W.ResizeObserver) {
    const ro = new ResizeObserver(queueRelayout);
    ro.observe(mainEl);
    disposers.push(() => ro.disconnect());
  }
  const tierChange = () => {
    syncTier();
    queueRelayout();
    /* the scene picks its quality tier at mount, so rebuild it when the viewport crosses the phone/desktop line */
    if (ctl && sceneBooted && (mqCoarse.matches || W.innerWidth < 900) !== sceneCoarse) {
      sceneBooted = false;
      clearTimeout(watchdog);
      bootScene();
    }
  };
  mqStage.addEventListener("change", tierChange);
  disposers.push(() => mqStage.removeEventListener("change", tierChange));

  /* ---------- go ---------- */
  measure();
  let fontsReady = false;
  let introWait = false;
  if (fx) {
    updHero(0);
    heroStatus.textContent = `${BUSINESS_NAME} · Ringing`;
    heroOn = false;
    H.classList.add(HOME_CLASSES.introPre);
    const safety = later(() => H.classList.remove(HOME_CLASSES.introPre), 3500);
    introGo = () => {
      clearTimeout(safety);
      startIntro();
    };
    later(() => {
      if (fontsReady) introGo?.();
      else introWait = true;
    }, 1200);
  }
  frame(readY());
  const fontsPromise = D.fonts?.ready ?? Promise.resolve();
  void fontsPromise.then(() => {
    if (destroyed) return;
    fontsReady = true;
    safe(initType);
    measure();
    measureCaptions();
    lockWords();
    safe(buildScrubs);
    if (fx) deps?.ScrollTrigger.refresh();
    if (ctl) {
      ctl.resize();
      ctl.setPlateRect(plateRect());
    }
    frame(readY());
    if (introWait || glOn) introGo?.();
  });

  /* ---------- debug and test API ---------- */
  const api: HeylooPageApi = {
    version: 1,
    mode: rm ? "static" : "fx",
    get tier() {
      return stageTier ? "stage" : "flow";
    },
    segments: () => ({ ...segs }),
    T: Tsum,
    clock: () =>
      clamp(
        (CALL_SECONDS * ((segs["call"] ?? 0) - CALL_PRE)) / (1 - CALL_PRE - CALL_POST),
        0,
        CALL_SECONDS,
      ),
    yFor,
    yForLink,
    yForCall: (t) => yFor("call", callP(t)),
    goto: (y) => scrollToY(y, true),
  };
  W.HeylooPage = api;
  disposers.push(() => {
    if (Object.is(W.HeylooPage, api)) delete W.HeylooPage;
  });

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const id of timers) clearTimeout(id);
      timers.clear();
      matchMedia_?.revert();
      if (deps) for (const st of deps.ScrollTrigger.getAll()) st.kill();
      for (const sp of splits) safe(() => sp.revert());
      for (const el of $$(".kx")) {
        el.style.removeProperty("--wg");
        el.style.removeProperty("--wd");
        el.style.removeProperty("width");
      }
      safe(() => ctl?.destroy());
      ctl = null;
      for (const dispose of disposers.splice(0).reverse()) safe(dispose);
    },
  };
}
