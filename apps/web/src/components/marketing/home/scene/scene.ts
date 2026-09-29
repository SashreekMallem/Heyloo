/**
 * "The Line": the home page's 3D scene (SITE-3, ported from the approved
 * prototype's scene module). One luminous line is the call, and the camera
 * rides it. Deterministic (mulberry32), no DOM access beyond the canvas it is
 * given, driven entirely through the controller `mountScene` returns.
 *
 * This file is only ever reached through a dynamic `import()` from the home
 * runtime, after first paint and only on a device that passes the gate, so
 * `three` never lands in a route's initial JS.
 */
import * as THREE from "three";
import { CALL_SECONDS } from "@/content/marketing/home";
import { type CallScript, type CallWord, energyAt, wordAmplitude } from "../voice-model";
import {
  BEAD_FS,
  BEAD_VS,
  CAL_FS,
  CAL_VS,
  CALP_FS,
  CALP_VS,
  DUST_FS,
  DUST_VS,
  LATLAB_FS,
  LATLAB_VS,
  LATTICE_FS,
  LATTICE_VS,
  PRIM_FS,
  PRIM_VS,
  RING_FS,
  RING_VS,
  SHEET_FS,
  SHEET_VS,
  STRAND_FS,
  STRAND_VS,
  TOKEN_FS,
  TOKEN_VS,
} from "./shaders";

const { Vector2, Vector3, Color } = THREE;

/* ------------------------------------------------------------------ constants and helpers */
const SEGMENT_IDS = [
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
export type SegmentId = (typeof SEGMENT_IDS)[number];
const SEG_INDEX: Record<string, number> = {};
SEGMENT_IDS.forEach((id, i) => {
  SEG_INDEX[id] = i;
});
const CALL_PRE = 0.04;
const CALL_POST = 0.085;
const S_CALL0 = 0.1;
const S_PER_SEC = 0.0065;
const S_HERO = 0.062;
const S_HOURS = 0.088;
const S_CAL = 0.464;
const S_PLATE = 0.56;
const RING_S = [0.797, 0.8215, 0.8465] as const;
const STRAND_GAIN = 0.34;
const HALO_GAIN = 0.075;
const SHEET_GAIN = 0.16;
const SW_RAW = 0.5;
const SW_SMOOTH = 1.25;
const E_CAP = 0.36;
const HP = 2.4; // plate world height
const DASH_SETTLE_END = 0.15;
const DASH_TILT = 6; // degrees of yaw the dashboard plane arrives with; it eases flat while the dashboard is read

/** The theme colours the scene draws with, as `#rrggbb`, plus whether the ground is dark. */
export interface SceneTokens {
  ground: string;
  surface: string;
  rule: string;
  line: string;
  ink: string;
  ink2: string;
  filament: string;
  ember: string;
  dark: boolean;
}
const DEFAULT_TOKENS: SceneTokens = {
  ground: "#0c0d10",
  surface: "#16171a",
  rule: "#313337",
  line: "#696c72",
  ink: "#f5f3f0",
  ink2: "#a8abb0",
  filament: "#e0edf6",
  ember: "#edbb6a",
  dark: true,
};

const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const sstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const sstep5 = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const sOfT = (t: number): number => S_CALL0 + S_PER_SEC * t;
const callClock = (p: number): number =>
  CALL_SECONDS * clamp((p - CALL_PRE) / (1 - CALL_PRE - CALL_POST), 0, 1);
const easeInOut4 = (p: number): number => (p < 0.5 ? 8 * p * p * p * p : 1 - (-2 * p + 2) ** 4 / 2);
const easeUI = (t: number): number => 1 - (1 - clamp(t, 0, 1)) ** 3.2; // stand-in for cubic-bezier(.2,.7,.1,1)
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Typed-array read that the strict index rules accept; out-of-range reads are 0, like the prototype's NaN-free paths. */
const at = (a: ArrayLike<number>, i: number): number => a[i] ?? 0;

/* ------------------------------------------------------------------ the path (built once, shared) */
const PATH_PTS: readonly (readonly [number, number, number])[] = [
  [0.0, 0.0, 6.0],
  [0.6, 0.1, -0.5],
  [1.8, 0.3, -7.0],
  [3.0, 0.5, -13.5],
  [3.6, 0.3, -20.0],
  [2.8, -0.1, -26.5],
  [1.0, -0.5, -33.0],
  [-1.2, -0.6, -39.5],
  [-3.0, -0.2, -46.0],
  [-3.6, 0.4, -52.5],
  [-2.4, 0.9, -59.0],
  [-0.2, 1.0, -65.5],
  [2.2, 0.6, -72.0],
  [3.6, 0.0, -78.5],
  [3.2, -0.5, -85.0],
  [1.2, -0.6, -91.5],
  [-1.0, -0.3, -98.0],
  [-2.4, 0.1, -104.5],
];
const NS = 1024;
/** The hero pose: the smooth body of the ribbon, never the folded end. */
const STILL_POSE: readonly number[] = [0.062, 14, -12, 6, 5.9, 0.32, 27, -3, 0.49, 0, 2];

interface PathData {
  L: number;
  P: Float32Array;
  T: Float32Array;
  N: Float32Array;
  B: Float32Array;
}
let PATH: PathData | null = null;
function buildPath(): PathData {
  if (PATH) return PATH;
  const curve = new THREE.CatmullRomCurve3(
    PATH_PTS.map((a) => new Vector3(a[0], a[1], a[2])),
    false,
    "centripetal",
  );
  curve.arcLengthDivisions = 4000;
  const L = curve.getLength();
  const P = new Float32Array((NS + 1) * 3);
  const T = new Float32Array((NS + 1) * 3);
  const N = new Float32Array((NS + 1) * 3);
  const B = new Float32Array((NS + 1) * 3);
  const b = new Vector3(0, 1, 0);
  const t = new Vector3();
  const p = new Vector3();
  const prev = new Vector3();
  const axis = new Vector3();
  const n = new Vector3();
  const tmp = new Vector3();
  for (let i = 0; i <= NS; i++) {
    const s = i / NS;
    curve.getPointAt(s, p);
    curve.getTangentAt(s, t).normalize();
    if (i === 0) {
      b.sub(tmp.copy(t).multiplyScalar(b.dot(t))).normalize();
    } else {
      axis.crossVectors(prev, t);
      const l = axis.length();
      if (l > 1e-8) {
        axis.divideScalar(l);
        b.applyAxisAngle(axis, Math.acos(clamp(prev.dot(t), -1, 1)));
      }
    }
    n.crossVectors(t, b).normalize();
    P.set([p.x, p.y, p.z], i * 3);
    T.set([t.x, t.y, t.z], i * 3);
    N.set([n.x, n.y, n.z], i * 3);
    B.set([b.x, b.y, b.z], i * 3);
    prev.copy(t);
  }
  PATH = { L, P, T, N, B };
  return PATH;
}
const _v = new Vector3();
function atArr(arr: Float32Array, s: number, out: THREE.Vector3): THREE.Vector3 {
  const f = clamp(s, 0, 1) * NS;
  const i = Math.min(NS - 1, Math.floor(f));
  const u = f - i;
  const a = i * 3;
  const b = a + 3;
  out.set(
    at(arr, a) + (at(arr, b) - at(arr, a)) * u,
    at(arr, a + 1) + (at(arr, b + 1) - at(arr, a + 1)) * u,
    at(arr, a + 2) + (at(arr, b + 2) - at(arr, a + 2)) * u,
  );
  return out;
}
/** Position on the path, with tangent extrapolation beyond the ends. */
function atP(s: number, out: THREE.Vector3): THREE.Vector3 {
  const { P, T, L } = buildPath();
  if (s >= 0 && s <= 1) return atArr(P, s, out);
  const e = s < 0 ? 0 : 1;
  atArr(P, e, out);
  atArr(T, e, _v);
  return out.addScaledVector(_v, (s - e) * L);
}
const atT = (s: number, out: THREE.Vector3): THREE.Vector3 =>
  atArr(buildPath().T, s, out).normalize();
const atN = (s: number, out: THREE.Vector3): THREE.Vector3 =>
  atArr(buildPath().N, s, out).normalize();
const atB = (s: number, out: THREE.Vector3): THREE.Vector3 =>
  atArr(buildPath().B, s, out).normalize();

/* ------------------------------------------------------------------ colour helpers */
function hexLum(hex: string): number {
  const c = new Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}
function normTokens(t?: Partial<SceneTokens> | null): SceneTokens {
  const o: SceneTokens = { ...DEFAULT_TOKENS, ...(t ?? {}) };
  if (!t || typeof t.dark !== "boolean") o.dark = hexLum(o.ground) < 0.2;
  return o;
}

/* ------------------------------------------------------------------ small builders */
function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2,
    y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}
function extrudedSlab(
  w: number,
  h: number,
  r: number,
  depth: number,
  bevel: number,
  bevelSeg: number,
): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(roundedRectShape(w, h, r), {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: bevelSeg,
    curveSegments: 14,
  });
  g.translate(0, 0, -(depth + bevel)); // front cap sits on z = 0, the body extends backwards (-z local = +T)
  g.computeVertexNormals();
  return g;
}
function planeInstGeom(): THREE.InstancedBufferGeometry {
  const src = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = src.index;
  g.setAttribute("position", src.getAttribute("position"));
  g.setAttribute("uv", src.getAttribute("uv"));
  return g;
}
type Uniforms = Record<string, THREE.IUniform>;
function hairMaterial(
  name: string,
  vs: string,
  fs: string,
  uniforms: Uniforms,
  extra?: THREE.ShaderMaterialParameters,
): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial(
    Object.assign(
      {
        name,
        vertexShader: vs,
        fragmentShader: fs,
        uniforms,
        transparent: false,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneMinusDstColorFactor,
        blendDst: THREE.OneFactor,
      },
      extra || {},
    ),
  );
  return m;
}

/* ------------------------------------------------------------------ the environment (light) */
function buildEnvScene(tk: SceneTokens): THREE.Scene {
  const sc = new THREE.Scene();
  const emit = (hex: string, k: number) =>
    new THREE.MeshBasicMaterial({
      color: new Color(hex).multiplyScalar(k),
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  const add = (
    w: number,
    h: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    rx: number,
    ry: number,
  ) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.rotation.set(rx || 0, ry || 0, 0);
    sc.add(m);
    return m;
  };
  if (tk.dark) {
    const room = new THREE.Mesh(
      new THREE.BoxGeometry(40, 30, 40),
      new THREE.MeshBasicMaterial({
        color: new Color(tk.ground).multiplyScalar(0.6),
        side: THREE.BackSide,
        toneMapped: false,
      }),
    );
    sc.add(room);
    add(9, 0.5, emit(tk.filament, 6), 0, 6, 0, Math.PI / 2, 0); // top key strip
    add(0.3, 7, emit(tk.filament, 4), 6, 0, 0, 0, -Math.PI / 2); // rim right
    add(0.3, 7, emit(tk.filament, 4), -6, 0, 0, 0, Math.PI / 2); // rim left
    add(8, 0.5, emit(tk.filament, 0.25), 0, -5, 0, -Math.PI / 2, 0); // floor card
    add(0.5, 5, emit(tk.ember, 1.2), -5.2, -1.5, -4.5, 0, Math.PI / 2.6); // the one warm strip, low behind-left
    add(0.32, 10, emit(tk.filament, 14), 0.0, 0.5, 8, 0, Math.PI); // soft vertical strip behind the viewer: the sweep across flat glass faces
    add(6, 1.4, emit(tk.filament, 3), -1.5, 3.2, 7.5, 0.35, Math.PI);
    const flag = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
    add(4, 9, flag, 4.6, 0, 5.5, 0, -1.1);
    add(4, 9, flag, -4.6, 0, 5.5, 0, 1.1);
  } else {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(20, 24, 16),
      new THREE.MeshBasicMaterial({
        color: new Color(0xffffff).multiplyScalar(1.1),
        side: THREE.BackSide,
        toneMapped: false,
      }),
    );
    sc.add(dome);
    const flag = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
    add(5, 8, flag, 4.2, 0, 3.2, 0, -0.9);
    add(5, 8, flag, -4.2, 0, 3.2, 0, 0.9);
    add(10, 4, flag, 0, 3.6, 4.5, 0.6, 0);
    add(0.5, 5, emit(tk.ember, 0.9), -5.2, -1.5, -4.5, 0, Math.PI / 2.6);
  }
  return sc;
}

/* ------------------------------------------------------------------ skeleton texture for the plate */
function drawSkeleton(cv: HTMLCanvasElement, aspect: number, tk: SceneTokens): void {
  const W = 1600,
    H = Math.max(240, Math.round(W / aspect));
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d");
  if (!g) return;
  g.clearRect(0, 0, W, H);
  const rr = (x: number, y: number, w: number, h: number, r: number) => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };
  const bar = (x: number, y: number, w: number, h: number, col: string, a: number) => {
    g.globalAlpha = a;
    g.fillStyle = col;
    rr(x, y, w, Math.max(h, 2), Math.min(h / 2, 6));
    g.fill();
  };
  const box = (x: number, y: number, w: number, h: number, r: number, a: number) => {
    g.globalAlpha = a;
    g.strokeStyle = tk.rule;
    g.lineWidth = 2;
    rr(x, y, w, h, r);
    g.stroke();
  };
  const u = W / 100,
    v = H / 100;
  // top bar
  bar(3 * u, 2.6 * v, 6 * u, 2.2 * v, tk.ink2, 0.55);
  [14, 20.5, 27].forEach((x, i) => {
    bar(x * u, 2.9 * v, (i === 0 ? 5 : 6) * u, 1.6 * v, tk.ink2, i === 0 ? 0.6 : 0.32);
  });
  bar(74 * u, 2.7 * v, 12 * u, 2 * v, tk.ink2, 0.4);
  box(88 * u, 2.2 * v, 8 * u, 3.0 * v, 8, 0.6);
  g.globalAlpha = 0.7;
  g.strokeStyle = tk.rule;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, 8 * v);
  g.lineTo(W, 8 * v);
  g.stroke();
  g.beginPath();
  g.moveTo(27 * u, 8 * v);
  g.lineTo(27 * u, H);
  g.stroke();
  // rail
  for (let i = 0; i < 4; i++) {
    const y = (10.5 + i * 11.5) * v;
    if (i === 0) {
      g.globalAlpha = 0.5;
      g.fillStyle = tk.rule;
      rr(1.2 * u, y - 1.6 * v, 24.6 * u, 10 * v, 10);
      g.fill();
    }
    bar(3 * u, y, 8 * u, 1.3 * v, tk.ink2, 0.4);
    bar(3 * u, y + 3 * v, 13 * u, 1.7 * v, tk.ink2, 0.65);
    box(3 * u, y + 6 * v, 7 * u, 2.2 * v, 10, 0.7);
    box(11 * u, y + 6 * v, 8 * u, 2.2 * v, 10, 0.7);
    g.globalAlpha = 0.5;
    g.strokeStyle = tk.rule;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, y + 9.3 * v);
    g.lineTo(27 * u, y + 9.3 * v);
    g.stroke();
  }
  // detail head
  bar(30 * u, 11.5 * v, 16 * u, 3 * v, tk.ink2, 0.7);
  box(48 * u, 11.8 * v, 6 * u, 2.4 * v, 10, 0.7);
  box(55 * u, 11.8 * v, 8 * u, 2.4 * v, 10, 0.7);
  bar(30 * u, 16.5 * v, 30 * u, 1.3 * v, tk.ink2, 0.4);
  // 2x2 blocks
  const bx = [30, 64.5],
    by = [21.5, 59],
    bw = 33,
    bh = 35;
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 2; c++) {
      const x = (bx[c] ?? 0) * u,
        y = (by[r] ?? 0) * v;
      box(x, y, bw * u, bh * v, 28, 0.75);
      bar(x + 2.2 * u, y + 3 * v, 7 * u, 1.3 * v, tk.ink2, 0.5);
      if (r === 0 && c === 0) {
        for (let k = 0; k < 6; k++)
          bar(
            x + 2.2 * u,
            y + (9 + k * 4.6) * v,
            (k % 2 ? 22 : 27) * u,
            1.3 * v,
            tk.ink2,
            k % 2 ? 0.3 : 0.5,
          );
      }
      if (r === 0 && c === 1) {
        bar(x + 2.2 * u, y + 15 * v, 3 * u, 4 * v, tk.ink2, 0.5);
        for (let k = 0; k < 96; k++) {
          const hh = (3 + 9 * Math.abs(Math.sin(k * 0.37) * Math.sin(k * 0.11 + 1.3))) * v;
          bar(x + (7 + k * 0.245) * u, y + 21 * v - hh / 2, 0.14 * u, hh, tk.ink2, 0.5);
        }
        bar(x + 26 * u, y + 29 * v, 4.5 * u, 1.3 * v, tk.ink2, 0.4);
      }
      if (r === 1 && c === 0) {
        for (let k = 0; k < 4; k++)
          bar(x + 2.2 * u, y + (9 + k * 5) * v, (k === 3 ? 14 : 27) * u, 1.3 * v, tk.ink2, 0.4);
      }
      if (r === 1 && c === 1) {
        for (let k = 0; k < 4; k++) {
          bar(x + 2.2 * u, y + (10 + k * 5) * v, 6 * u, 1.2 * v, tk.ink2, 0.35);
          bar(x + 10 * u, y + (10 + k * 5) * v, 11 * u, 1.3 * v, tk.ink2, 0.6);
        }
        for (let k = 0; k < 5; k++) box(x + 24 * u, y + (7 + k * 5.2) * v, 7 * u, 4 * v, 8, 0.6);
      }
    }
  g.globalAlpha = 1;
}

/* ------------------------------------------------------------------ mount */
export interface SceneOptions {
  /** Reduced motion: one still frame of the hero pose, no scroll driving. */
  reducedMotion: boolean;
  /** Phones and coarse pointers get the lite tier and the phone camera. */
  coarse: boolean;
  theme: Partial<SceneTokens>;
  script: CallScript;
  /** CSS font-family list the canvas labels are drawn with (the page's mono face). */
  monoFamily: string;
  adaptive?: boolean;
  /** Called once, after the first frame is on the canvas. */
  onFirstFrame?: () => void;
  /** Called when the scene cannot go on (context lost for good). */
  onError?: (reason: string) => void;
}

export interface PlateRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SceneDebug {
  T: number;
  tier: string;
  dpr: number;
  calls: number;
  triangles: number;
  frame: number;
  fps: number;
  idle: boolean;
  ember: number;
  plate: PlateRect | null;
}

export interface SceneController {
  readonly tier: string;
  /** Scroll progress (0 to 1) of one of the 13 chapter and hand-over segments. */
  setProgress(id: string, p: number): void;
  /** Phones: the bands of the viewport (px from the top) where readable copy sits right now, so the light stays off it. */
  setCopyBands(bands: readonly (readonly [number, number])[], vh: number): void;
  setDim(v: number): void;
  setPointer(x: number, y: number): void;
  setTheme(t: Partial<SceneTokens>): void;
  setPlateRect(r: PlateRect | null): void;
  resize(): void;
  pause(): void;
  resume(): void;
  snap(): void;
  destroy(keepContext?: boolean): void;
  debug(): SceneDebug;
}

let current: SceneController | null = null;

type Tier = "full" | "lite" | "low";

/** A WebGL2 renderer on the canvas, or `null` when the machine has none (no console noise either way). */
function createRenderer(
  canvas: HTMLCanvasElement,
  antialias: boolean,
  remount: boolean,
): THREE.WebGLRenderer | null {
  try {
    // Probe first so a machine without WebGL2 exits quietly (three.js would log console errors).
    const probe = document.createElement("canvas");
    const pg = probe.getContext("webgl2");
    if (!pg) return null;
    void pg.getParameter(pg.MAX_TEXTURE_SIZE);
    probe.width = probe.height = 0; // drop the probe quietly, no forced context loss
  } catch {
    return null;
  }
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    if (remount) {
      // A remount reuses the canvas context: clear the pixel-store state the old renderer left.
      const pre = canvas.getContext("webgl2");
      if (pre) {
        pre.pixelStorei(pre.UNPACK_FLIP_Y_WEBGL, false);
        pre.pixelStorei(pre.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      }
    }
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias,
      alpha: false,
      powerPreference: "high-performance",
      stencil: false,
    });
    const gl = renderer.getContext();
    if (typeof WebGL2RenderingContext === "undefined" || !(gl instanceof WebGL2RenderingContext)) {
      throw new Error("webgl2 unavailable");
    }
    return renderer;
  } catch {
    try {
      renderer?.dispose();
    } catch {
      // nothing more to release
    }
    return null;
  }
}

function mountInternal(canvas: HTMLCanvasElement, opts: SceneOptions): SceneController | null {
  const remount = !!current;
  if (current) {
    try {
      current.destroy(true);
    } catch (e) {
      /* ignore */
    }
  }
  const PATHD = buildPath();
  const L = PATHD.L;

  /* ---------- tier ---------- */
  const cssW0 = canvas.clientWidth || 1,
    cssH0 = canvas.clientHeight || 1;
  const cores = navigator.hardwareConcurrency || 8;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory || 8;
  let tier: Tier = "full";
  if (opts.coarse || cssW0 < 900 || (cores <= 4 && mem <= 4)) tier = "lite";
  if (cores <= 2 && !opts.coarse) tier = "low";
  const still = !!opts.reducedMotion;
  const adaptive = opts.adaptive !== false && !still;
  const cfg = {
    strands: still ? 16 : 8,
    sheet: tier !== "low",
    halo: tier === "full",
    dust: tier === "full" ? 320 : tier === "lite" ? 120 : 0,
    transmission: tier === "full",
    dprCap: tier === "full" ? 1.75 : 1.5,
    aa: tier !== "low",
    dof: tier !== "low",
    pmrem: tier !== "low",
  };

  /* ---------- renderer ---------- */
  const created = createRenderer(canvas, cfg.aa, remount);
  if (!created) return null;
  const renderer: THREE.WebGLRenderer = created;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.transmissionResolutionScale = 0.5;
  renderer.info.autoReset = true;

  let tk = normTokens(opts.theme);
  let tkFrom = tk;
  const colors = {
    ground: new Color(tk.ground),
    surface: new Color(tk.surface),
    rule: new Color(tk.rule),
    ink: new Color(tk.ink),
    ink2: new Color(tk.ink2),
    filament: new Color(tk.filament),
    ember: new Color(tk.ember),
  };
  renderer.setClearColor(colors.ground, 1);
  renderer.toneMappingExposure = tk.dark ? 1.0 : 0.95;

  let dpr = Math.min(window.devicePixelRatio || 1, cfg.dprCap);
  let cssW = cssW0,
    cssH = cssH0;
  renderer.setPixelRatio(dpr);
  renderer.setSize(cssW, cssH, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, cssW / cssH, 0.1, 140);

  /* ---------- shared uniforms ---------- */
  const U = {
    uRes: { value: new Vector2(cssW * dpr, cssH * dpr) },
    uDpr: { value: dpr },
    uDark: { value: tk.dark ? 1 : 0 },
    uFog: { value: new Vector2(18, 46) },
    uMaskMix: { value: 0.3 },
    uMaskA: { value: new THREE.Vector4(0.56, 0.55, 0, 0) },
    uMaskB1: { value: new Vector3(0, 0, 0) },
    uMaskB2: { value: new Vector3(0, 0, 0) },
    uMaskR: { value: new THREE.Vector4(0, 0, 0, 0) },
    uMaskRS: { value: 0 },
    uFilament: { value: colors.filament.clone() },
    uInk2: { value: colors.ink2.clone() },
    uPlC: { value: new Vector3() },
    uPlF: { value: new Vector3(0, 0, 1) },
    uPlN: { value: new Vector3(1, 0, 0) },
    uPlB: { value: new Vector3(0, 1, 0) },
    uPlHalf: { value: new Vector2(1, 1) },
    uPlVis: { value: 0 },
    uCopy: { value: Array.from({ length: 6 }, () => new Vector3(0, 0, 0)) },
  };
  const shared = (o: Uniforms): Uniforms => Object.assign({}, U, o);
  const hair: THREE.ShaderMaterial[] = []; // materials whose blending follows the theme
  const reg = <M extends THREE.ShaderMaterial>(m: M): M => {
    hair.push(m);
    return m;
  };
  const gpu: { dispose(): void }[] = []; // everything to dispose
  const track = <O extends { dispose(): void }>(o: O): O => {
    gpu.push(o);
    return o;
  };

  /* ---------- voice data ---------- */
  const script = opts.script.words.length ? opts.script : null;
  const words: readonly CallWord[] = script ? script.words : [];
  const utter: CallScript["utterances"] = script ? script.utterances : [];

  /* ---------- A. the filament ---------- */
  const strandU = {
    uWidthPx: { value: 1.3 * dpr },
    uFocus: { value: 5 },
    uFan: { value: 0 },
    uLaneIdx: { value: 0 },
    uFar: { value: 1 },
    uHead: { value: S_HERO },
    uGhost: { value: tk.dark ? 0.3 : 0.28 },
    uReveal: { value: still ? 1.9 : 0 },
    uAlpha: { value: 1 },
    uGain: { value: STRAND_GAIN },
    uRip: { value: 1 },
    uTaper: { value: 1 },
    uAF: { value: 0 },
    uGap: { value: 0.2 },
    uSwell: { value: 1 },
  };
  const strandMat = reg(track(hairMaterial("strand", STRAND_VS, STRAND_FS, shared(strandU))));
  const haloU = {
    uWidthPx: { value: 5 * dpr },
    uFocus: strandU.uFocus,
    uFan: strandU.uFan,
    uLaneIdx: strandU.uLaneIdx,
    uFar: strandU.uFar,
    uHead: strandU.uHead,
    uGhost: strandU.uGhost,
    uReveal: strandU.uReveal,
    uAlpha: strandU.uAlpha,
    uRip: strandU.uRip,
    uTaper: strandU.uTaper,
    uAF: strandU.uAF,
    uGap: strandU.uGap,
    uSwell: strandU.uSwell,
    uGain: { value: HALO_GAIN },
  };
  const haloMat = reg(track(hairMaterial("halo", STRAND_VS, STRAND_FS, shared(haloU))));

  const sampleS: number[] = [];
  {
    const seg = (a: number, b: number, n: number, skipFirst: boolean) => {
      for (let i = skipFirst ? 1 : 0; i <= n; i++) sampleS.push(a + ((b - a) * i) / n);
    };
    seg(0, 0.09, 70, false);
    seg(0.09, 0.49, 600, true);
    seg(0.49, 1.0, 220, true);
    seg(1.0, 1.8, 24, true);
  }
  const NSM = sampleS.length;
  const strandGeo = track(new THREE.InstancedBufferGeometry());
  const pTmp = new Vector3(),
    nTmp = new Vector3(),
    bTmp = new Vector3();
  (function buildStrandGeometry() {
    const V = NSM * 2;
    const aP = new Float32Array(V * 3),
      aN = new Float32Array(V * 3),
      aB = new Float32Array(V * 3),
      aP1 = new Float32Array(V * 3),
      aN1 = new Float32Array(V * 3),
      aB1 = new Float32Array(V * 3);
    const aV = new Float32Array(V * 2),
      aV1 = new Float32Array(V * 2),
      aU = new Float32Array(V * 2),
      aSide = new Float32Array(V);
    const ev = new Float32Array(NSM * 2);
    if (script) {
      // per speaker energy on a 20 Hz timeline, blurred with two gaussians, so the swell follows phrases and never shows a word-level sawtooth
      const T0 = -4,
        DT = 0.05,
        NT = Math.ceil((CALL_SECONDS + 8) / DT);
      const gauss = (src: Float32Array, sig: number) => {
        const r = Math.ceil((sig / DT) * 3),
          ker = new Float32Array(2 * r + 1);
        let ks = 0;
        for (let k = -r; k <= r; k++) {
          const v = Math.exp(-0.5 * ((k * DT) / sig) ** 2);
          ker[k + r] = v;
          ks += v;
        }
        const out = new Float32Array(NT);
        for (let i = 0; i < NT; i++) {
          let acc = 0;
          for (let k = -r; k <= r; k++) {
            const j = i + k;
            if (j >= 0 && j < NT) acc += at(src, j) * at(ker, k + r);
          }
          out[i] = acc / ks;
        }
        return out;
      };
      const tls = [words.filter((w) => w.spk === 0), words.filter((w) => w.spk === 1)].map((ws) => {
        const raw = new Float32Array(NT);
        for (let i = 0; i < NT; i++) raw[i] = energyAt(T0 + i * DT, ws);
        const A = gauss(raw, 0.9),
          B = gauss(raw, 0.28),
          out = new Float32Array(NT);
        for (let i = 0; i < NT; i++)
          out[i] = clamp(SW_SMOOTH * at(A, i) + SW_RAW * at(B, i), 0, E_CAP);
        return out;
      });
      for (let i = 0; i < NSM; i++) {
        const t = (at(sampleS, i) - S_CALL0) / S_PER_SEC;
        const f = (t - T0) / DT;
        if (f < 0 || f > NT - 1) continue;
        const i0 = Math.floor(f),
          u = f - i0,
          i1 = Math.min(NT - 1, i0 + 1);
        for (let sp = 0; sp < 2; sp++) {
          const tl = tls[sp] ?? new Float32Array(NT);
          ev[i * 2 + sp] = at(tl, i0) * (1 - u) + at(tl, i1) * u;
        }
      }
    }
    const q = new Vector3();
    for (let i = 0; i < NSM; i++) {
      const j = Math.min(i + 1, NSM - 1);
      const s0 = at(sampleS, i);
      const s1 = i === NSM - 1 ? s0 + (s0 - at(sampleS, i - 1)) : at(sampleS, j);
      for (let side = 0; side < 2; side++) {
        const idx = i * 2 + side;
        atP(s0, pTmp);
        atN(s0, nTmp);
        atB(s0, bTmp);
        aP.set([pTmp.x, pTmp.y, pTmp.z], idx * 3);
        aN.set([nTmp.x, nTmp.y, nTmp.z], idx * 3);
        aB.set([bTmp.x, bTmp.y, bTmp.z], idx * 3);
        atP(s1, q);
        atN(s1, nTmp);
        atB(s1, bTmp);
        aP1.set([q.x, q.y, q.z], idx * 3);
        aN1.set([nTmp.x, nTmp.y, nTmp.z], idx * 3);
        aB1.set([bTmp.x, bTmp.y, bTmp.z], idx * 3);
        aV[idx * 2] = at(ev, i * 2);
        aV[idx * 2 + 1] = at(ev, i * 2 + 1);
        aV1[idx * 2] = at(ev, j * 2);
        aV1[idx * 2 + 1] = at(ev, j * 2 + 1);
        aU[idx * 2] = s0;
        aU[idx * 2 + 1] = s1;
        aSide[idx] = side ? 1 : -1;
      }
    }
    const idxArr = new Uint32Array((NSM - 1) * 6);
    for (let i = 0; i < NSM - 1; i++) {
      const a = i * 2,
        b = a + 1,
        c = a + 2,
        d = a + 3;
      idxArr.set([a, b, c, b, d, c], i * 6);
    }
    strandGeo.setIndex(new THREE.BufferAttribute(idxArr, 1));
    strandGeo.setAttribute("position", new THREE.BufferAttribute(aP, 3));
    strandGeo.setAttribute("aN", new THREE.BufferAttribute(aN, 3));
    strandGeo.setAttribute("aB", new THREE.BufferAttribute(aB, 3));
    strandGeo.setAttribute("aP1", new THREE.BufferAttribute(aP1, 3));
    strandGeo.setAttribute("aN1", new THREE.BufferAttribute(aN1, 3));
    strandGeo.setAttribute("aB1", new THREE.BufferAttribute(aB1, 3));
    strandGeo.setAttribute("aV", new THREE.BufferAttribute(aV, 2));
    strandGeo.setAttribute("aV1", new THREE.BufferAttribute(aV1, 2));
    strandGeo.setAttribute("aU", new THREE.BufferAttribute(aU, 2));
    strandGeo.setAttribute("aSide", new THREE.BufferAttribute(aSide, 1));
  })();
  function setStrandCount(n: number) {
    const aK = new Float32Array(n),
      aLead = new Float32Array(n);
    for (let k = 0; k < n; k++) aK[k] = (k + 0.5) / n;
    aLead[Math.max(0, n / 2 - 1)] = 1;
    aLead[Math.min(n - 1, n / 2)] = 1; // the two rims of the ribbon carry a slightly firmer line
    strandGeo.setAttribute("aK", new THREE.InstancedBufferAttribute(aK, 1));
    strandGeo.setAttribute("aLead", new THREE.InstancedBufferAttribute(aLead, 1));
    strandGeo.instanceCount = n;
    const gk = (8 / n) ** 0.55;
    strandU.uGain.value = STRAND_GAIN * gk;
    haloU.uGain.value = HALO_GAIN * gk;
    haloGeo.setAttribute("aK", strandGeo.getAttribute("aK"));
    haloGeo.setAttribute("aLead", strandGeo.getAttribute("aLead"));
    haloGeo.instanceCount = n;
  }
  const haloGeo = track(new THREE.InstancedBufferGeometry());
  for (const nm of ["position", "aN", "aB", "aP1", "aN1", "aB1", "aV", "aV1", "aU", "aSide"]) {
    haloGeo.setAttribute(nm, strandGeo.getAttribute(nm));
  }
  haloGeo.setIndex(strandGeo.index);
  setStrandCount(cfg.strands);
  /* the sheet: a quiet glass veil between the strands, one per speaker */
  const sheetU = {
    uHead: strandU.uHead,
    uGhost: strandU.uGhost,
    uReveal: strandU.uReveal,
    uAlpha: strandU.uAlpha,
    uFan: strandU.uFan,
    uFar: strandU.uFar,
    uRip: strandU.uRip,
    uTaper: strandU.uTaper,
    uAF: strandU.uAF,
    uGap: strandU.uGap,
    uSwell: strandU.uSwell,
    uSheetGain: { value: SHEET_GAIN },
  };
  const sheetMat = reg(track(hairMaterial("sheet", SHEET_VS, SHEET_FS, shared(sheetU))));
  const sheetGeo = track(new THREE.InstancedBufferGeometry());
  for (const nm of ["position", "aN", "aB", "aV", "aU", "aSide"]) {
    sheetGeo.setAttribute(nm, strandGeo.getAttribute(nm));
  }
  sheetGeo.setIndex(strandGeo.index);
  sheetGeo.setAttribute(
    "aK",
    new THREE.InstancedBufferAttribute(new Float32Array([0.25, 0.75]), 1),
  );
  sheetGeo.instanceCount = 2;
  const sheet = new THREE.Mesh(sheetGeo, sheetMat);
  sheet.frustumCulled = false;
  sheet.renderOrder = 2;
  sheet.visible = cfg.sheet;
  scene.add(sheet);
  const strands = new THREE.Mesh(strandGeo, strandMat);
  strands.frustumCulled = false;
  strands.renderOrder = 4;
  scene.add(strands);
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.frustumCulled = false;
  halo.renderOrder = 3;
  halo.visible = cfg.halo;
  scene.add(halo);

  /* ---------- B. head bead ---------- */
  const beadU = {
    uPos: { value: new Vector3() },
    uCol: { value: colors.ember.clone() },
    uAlpha: { value: 0 },
    uRadiusPx: { value: 30 * dpr },
    uRes: U.uRes,
    uDpr: U.uDpr,
    uCopy: U.uCopy,
  };
  const beadMat = track(
    new THREE.ShaderMaterial({
      name: "bead",
      vertexShader: BEAD_VS,
      fragmentShader: BEAD_FS,
      uniforms: beadU,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const beadGeo = track(new THREE.PlaneGeometry(2, 2));
  const bead = new THREE.Mesh(beadGeo, beadMat);
  bead.frustumCulled = false;
  bead.renderOrder = 30;
  bead.visible = false;
  scene.add(bead);

  /* ---------- C. word tokens ---------- */
  const tokU = { uClock: { value: 0 }, uTokVis: { value: 0 } };
  const tokMat = reg(track(hairMaterial("tokens", TOKEN_VS, TOKEN_FS, shared(tokU))));
  let tokens: THREE.Mesh | null = null;
  if (words.length) {
    const nW = words.length,
      g = track(planeInstGeom());
    const aFrom = new Float32Array(nW * 3),
      aTo = new Float32Array(nW * 3),
      aRight = new Float32Array(nW * 3),
      aUp = new Float32Array(nW * 3),
      aSize = new Float32Array(nW * 2),
      aInfo = new Float32Array(nW * 3);
    const fN = new Vector3(),
      fB = new Vector3(),
      fT = new Vector3(),
      pc = new Vector3(),
      nrm = new Vector3(),
      rgt = new Vector3(),
      up = new Vector3(),
      tmp = new Vector3();
    const byU = new Map<number, number[]>();
    words.forEach((w, i) => {
      const list = byU.get(w.u) ?? [];
      list.push(i);
      byU.set(w.u, list);
    });
    const YAW = (16 * Math.PI) / 180;
    byU.forEach((idxs, key) => {
      const first = words[idxs[0] ?? 0];
      const u = utter.find((x) => x.i === key) || { t0: first?.t ?? 0, spk: first?.spk ?? 0 };
      const sU = sOfT(u.t0);
      const side = u.spk === 0 ? 1 : -1;
      atP(sU, pc);
      atT(sU, fT);
      atN(sU, fN);
      atB(sU, fB);
      nrm
        .copy(fT)
        .multiplyScalar(-Math.cos(YAW))
        .addScaledVector(fN, -side * Math.sin(YAW))
        .normalize();
      rgt.crossVectors(fB, nrm).normalize();
      up.crossVectors(nrm, rgt).normalize();
      // layout
      const wid = idxs.map((i) => Math.max(0.07, 0.034 * (words[i]?.n ?? 0)));
      const GAP = 0.04,
        WRAP = 2.4;
      let x = 0,
        line = 0;
      const pos: [number, number][] = [];
      idxs.forEach((_wi, k) => {
        const wk = wid[k] ?? 0;
        if (x > 0 && x + wk > WRAP) {
          x = 0;
          line++;
        }
        pos.push([x + wk / 2, line]);
        x += wk + GAP;
      });
      const nL = line + 1;
      idxs.forEach((wi, k) => {
        const w = words[wi];
        const p = pos[k];
        if (!w || !p) return;
        const [px, ln] = p;
        const lx = px - WRAP / 2,
          ly = ((nL - 1) / 2 - ln) * 0.14;
        tmp
          .copy(pc)
          .addScaledVector(fN, side * 1.5)
          .addScaledVector(rgt, lx)
          .addScaledVector(up, ly);
        aTo.set([tmp.x, tmp.y, tmp.z], wi * 3);
        const sw = sOfT(w.t + w.d * 0.5);
        atP(sw, tmp);
        atN(sw, fN);
        const lat = side * (0.018 + wordAmplitude(w) * (0.08 + 0.72 * 0.5));
        tmp.addScaledVector(fN, lat * 0.53);
        atB(sw, fB);
        tmp.addScaledVector(fB, lat * 0.848);
        aFrom.set([tmp.x, tmp.y, tmp.z], wi * 3);
        aRight.set([rgt.x, rgt.y, rgt.z], wi * 3);
        aUp.set([up.x, up.y, up.z], wi * 3);
        aSize.set([wid[k] ?? 0, 0.07], wi * 2);
        aInfo.set([sw, w.spk, w.t], wi * 3);
      });
    });
    g.setAttribute("aFrom", new THREE.InstancedBufferAttribute(aFrom, 3));
    g.setAttribute("aTo", new THREE.InstancedBufferAttribute(aTo, 3));
    g.setAttribute("aRight", new THREE.InstancedBufferAttribute(aRight, 3));
    g.setAttribute("aUp", new THREE.InstancedBufferAttribute(aUp, 3));
    g.setAttribute("aSize", new THREE.InstancedBufferAttribute(aSize, 2));
    g.setAttribute("aInfo", new THREE.InstancedBufferAttribute(aInfo, 3));
    g.instanceCount = nW;
    tokens = new THREE.Mesh(g, tokMat);
    tokens.frustumCulled = false;
    tokens.renderOrder = 6;
    tokens.visible = false;
    scene.add(tokens);
  }

  /* ---------- D. week lattice ---------- */
  const LAT_SQ = 0.7;
  const latPair = cssW0 < 900; // phones: 84 bars, one per two hours, so the week stays readable
  const latFrame = { C: new Vector3(), R: new Vector3(), D: new Vector3() };
  {
    const fT = new Vector3(),
      fN = new Vector3(),
      fB = new Vector3(),
      c = new Vector3();
    const a = (4 * Math.PI) / 180;
    atP(S_HOURS, c);
    atT(S_HOURS, fT);
    atN(S_HOURS, fN);
    atB(S_HOURS, fB);
    latFrame.C.copy(c).addScaledVector(fB, -0.05).addScaledVector(fN, 0.15);
    latFrame.R.copy(fN);
    latFrame.D.copy(fB).multiplyScalar(Math.cos(a)).addScaledVector(fT, -Math.sin(a)).normalize();
  }
  const latU = {
    uLC: { value: latFrame.C },
    uLR: { value: latFrame.R },
    uLD: { value: latFrame.D },
    uSweep: { value: 0 },
    uDone: { value: 0 },
    uLatVis: { value: 0 },
    uWidthPx: { value: 1.7 * dpr },
    uPair: { value: latPair ? 1 : 0 },
    uEmber: { value: colors.ember.clone() },
  };
  const latMat = reg(track(hairMaterial("lattice", LATTICE_VS, LATTICE_FS, shared(latU))));
  const latGeo = track(new THREE.InstancedBufferGeometry());
  {
    latGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]), 3),
    );
    latGeo.setIndex([0, 1, 2, 1, 3, 2]);
    const aH = new Float32Array(169),
      aC = new Float32Array(169);
    let nB = 0;
    for (let h = 0; h < 168; h++) {
      if (latPair && h & 1) continue;
      aH[nB] = h;
      const day = Math.floor(h / 24),
        hr = h % 24;
      aC[nB] = day < 5 && hr >= 8 && hr <= 17 ? 0 : 1;
      nB++;
    }
    aH[nB] = 168;
    aC[nB] = 1;
    nB++; // the scan marker
    latGeo.setAttribute("aH", new THREE.InstancedBufferAttribute(aH, 1));
    latGeo.setAttribute("aClosed", new THREE.InstancedBufferAttribute(aC, 1));
    latGeo.instanceCount = nB;
  }
  const lattice = new THREE.Mesh(latGeo, latMat);
  lattice.frustumCulled = false;
  lattice.renderOrder = 5;
  lattice.visible = false;
  scene.add(lattice);
  /* the week frame: hairline around the 50 open hours, day and hour labels in the page mono */
  const LHX = 2.4,
    LHY = 1.62;
  const latLabU = {
    uLatTex: { value: null as THREE.CanvasTexture | null },
    uLHalf: { value: new Vector2(LHX, LHY) },
  };
  const latLabMat = reg(
    track(hairMaterial("latlab", LATLAB_VS, LATLAB_FS, Object.assign(shared(latU), latLabU))),
  );
  let latCv: HTMLCanvasElement | null = null,
    latTex: THREE.CanvasTexture | null = null;
  function drawLatLabels() {
    const W = 1536,
      Hh = Math.round((W * LHY) / LHX);
    if (!latCv) latCv = document.createElement("canvas");
    latCv.width = W;
    latCv.height = Hh;
    const g = latCv.getContext("2d");
    if (!g) return;
    g.fillStyle = "#000";
    g.fillRect(0, 0, W, Hh);
    const px = (x: number) => (x / (2 * LHX) + 0.5) * W,
      py = (dp: number) => (0.5 - dp / (2 * LHY)) * Hh;
    const fs = latPair ? 40 : 25;
    g.font = "500 " + fs + "px " + opts.monoFamily;
    g.textBaseline = "middle";
    if ("letterSpacing" in g) g.letterSpacing = "1.5px";
    g.globalCompositeOperation = "lighter";
    const step = 0.15,
      x0 = (8 - 11.5) * step - 0.075 - 0.06,
      x1 = (17 - 11.5) * step + 0.075 + 0.06 + (latPair ? 0.15 : 0),
      y1 = 1.02 + 0.19,
      y0 = (3 - 4) * 0.34 - 0.19;
    const rx = px(x0),
      ry = py(y1),
      rw = px(x1) - px(x0),
      rh = py(y0) - py(y1),
      r = 18;
    g.beginPath();
    g.moveTo(rx + r, ry);
    g.arcTo(rx + rw, ry, rx + rw, ry + rh, r);
    g.arcTo(rx + rw, ry + rh, rx, ry + rh, r);
    g.arcTo(rx, ry + rh, rx, ry, r);
    g.arcTo(rx, ry, rx + rw, ry, r);
    g.closePath();
    g.fillStyle = "#00ff00";
    g.fill(); // faint glass fill (green channel)
    g.strokeStyle = "#ff0000";
    g.lineWidth = 2.2;
    g.stroke(); // 1 px rim (red channel)
    g.fillStyle = "#ff0000";
    g.textAlign = "right";
    const sq = latPair ? 1 / LAT_SQ : 1; // the plane is squeezed on phones, so the glyphs are pre-stretched
    g.save();
    g.scale(sq, 1);
    (
      [
        ["MON", 0],
        ["WED", 2],
        ["FRI", 4],
        ["SUN", 6],
      ] as const
    ).forEach((a) => {
      g.fillText(a[0], px(-1.83) / sq, py((3 - a[1]) * 0.34));
    });
    g.textAlign = "center";
    const hx = (h: number) => (h + 0.5 - 11.5) * step + (latPair ? 0.075 : 0);
    g.fillText("8 AM", px(hx(8)) / sq, py(-1.02 - 0.44));
    g.fillText("6 PM", px(hx(18)) / sq, py(-1.02 - 0.44));
    g.restore();
    if (!latTex) {
      latTex = new THREE.CanvasTexture(latCv);
      latTex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      latTex.generateMipmaps = true;
      latTex.minFilter = THREE.LinearMipmapLinearFilter;
      track(latTex);
      latLabU.uLatTex.value = latTex;
    }
    latTex.needsUpdate = true;
  }
  drawLatLabels();
  if (document.fonts && document.fonts.ready)
    document.fonts.ready.then(() => {
      if (!destroyed && !lost) {
        drawLatLabels();
        dirty = true;
        kick();
      }
    });
  const latLab = new THREE.Mesh(track(new THREE.PlaneGeometry(1, 1)), latLabMat);
  latLab.frustumCulled = false;
  latLab.renderOrder = 4;
  latLab.visible = false;
  scene.add(latLab);

  /* ---------- E. calendar and the slab ---------- */
  const calFrame = { C: new Vector3(), N: new Vector3(), B: new Vector3(), T: new Vector3() };
  atP(S_CAL, calFrame.C);
  atN(S_CAL, calFrame.N);
  atB(S_CAL, calFrame.B);
  atT(S_CAL, calFrame.T);
  const calU = {
    uCalC: { value: calFrame.C },
    uCalN: { value: calFrame.N },
    uCalB: { value: calFrame.B },
    uCalT: { value: calFrame.T },
    uCpHalf: { value: new Vector2(1.58, 1.28) },
    uCpOff: { value: new Vector2(-0.24, -0.09) },
    uLab: { value: null as THREE.CanvasTexture | null },
    uCalVis: { value: 0 },
    uCalCells: { value: 0 },
    uCalTarget: { value: 0 },
    uCalEdge: { value: 0 },
    uEmberMix: { value: 0 },
    uEmber: { value: colors.ember.clone() },
  };
  const calMat = reg(track(hairMaterial("calendar", CAL_VS, CAL_FS, shared(calU))));
  const calGeo = track(planeInstGeom());
  {
    const filled = [
      [0, 2],
      [0, 7],
      [1, 4],
      [1, 9],
      [3, 1],
      [3, 6],
      [4, 4],
    ];
    const cells: number[] = [],
      flags: number[] = [];
    for (let c = 0; c < 5; c++)
      for (let r = 0; r < 12; r++) {
        cells.push(c, r);
        const f = filled.some((x) => x[0] === c && x[1] === r) ? 1 : 0;
        flags.push(f, c === 2 && r === 5 ? 1 : 0);
      }
    calGeo.setAttribute("aCell", new THREE.InstancedBufferAttribute(new Float32Array(cells), 2));
    calGeo.setAttribute("aFlag", new THREE.InstancedBufferAttribute(new Float32Array(flags), 2));
    calGeo.instanceCount = 60;
  }
  const calendar = new THREE.Mesh(calGeo, calMat);
  calendar.frustumCulled = false;
  calendar.renderOrder = 6;
  calendar.visible = false;
  scene.add(calendar);
  const calPMat = reg(track(hairMaterial("calplate", CALP_VS, CALP_FS, shared(calU))));
  let labTex: THREE.CanvasTexture | null = null,
    labCv: HTMLCanvasElement | null = null;
  function drawCalLabels() {
    const HALF = calU.uCpHalf.value,
      OFF = calU.uCpOff.value;
    const W = 1024,
      Hh = Math.round((W * HALF.y) / HALF.x);
    if (!labCv) labCv = document.createElement("canvas");
    labCv.width = W;
    labCv.height = Hh;
    const g = labCv.getContext("2d");
    if (!g) return;
    g.fillStyle = "#000";
    g.fillRect(0, 0, W, Hh);
    g.font = "500 23px " + opts.monoFamily;
    g.textBaseline = "middle";
    if ("letterSpacing" in g) g.letterSpacing = "1.5px";
    const px = (gx: number) => ((gx - OFF.x) / (2 * HALF.x) + 0.5) * W,
      py = (gy: number) => (0.5 - (gy - OFF.y) / (2 * HALF.y)) * Hh;
    g.globalCompositeOperation = "lighter";
    g.fillStyle = "#ff0000";
    g.textAlign = "center";
    ["MON", "TUE", "WED", "THU", "FRI"].forEach((d, c) => {
      g.fillText(d, px((c - 2) * 0.52), py(1.1));
    });
    g.textAlign = "right";
    (
      [
        ["8 AM", 0],
        ["10 AM", 4],
        ["12 PM", 8],
      ] as const
    ).forEach((a) => {
      g.fillText(a[0], px(-1.36), py((5 - a[1]) * 0.18));
    });
    g.fillStyle = "#00ff00";
    g.fillText("10:30", px(-1.36), py(0));
    if (!labTex) {
      labTex = new THREE.CanvasTexture(labCv);
      labTex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      labTex.generateMipmaps = true;
      labTex.minFilter = THREE.LinearMipmapLinearFilter;
      track(labTex);
      calU.uLab.value = labTex;
    }
    labTex.needsUpdate = true;
  }
  drawCalLabels();
  if (document.fonts && document.fonts.ready)
    document.fonts.ready.then(() => {
      if (!destroyed && !lost) {
        drawCalLabels();
        dirty = true;
        kick();
      }
    });
  const calPlate = new THREE.Mesh(track(new THREE.PlaneGeometry(1, 1)), calPMat);
  calPlate.frustumCulled = false;
  calPlate.renderOrder = 5;
  calPlate.visible = false;
  scene.add(calPlate);

  let envTex: THREE.Texture | null = null;
  let pmrem = new THREE.PMREMGenerator(renderer);
  function buildEnv() {
    if (!cfg.pmrem) return;
    const es = buildEnvScene(tk);
    const rt = pmrem.fromScene(es, 0.04);
    es.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    envTex = rt.texture;
    envRT = rt;
    slabMat.envMap = envTex;
    slabMat.needsUpdate = true;
    plateMat.envMap = envTex;
    plateMat.needsUpdate = true;
    if (oldRT) {
      oldRT.dispose();
    }
    oldRT = rt;
  }
  let envRT: THREE.WebGLRenderTarget | null = null,
    oldRT: THREE.WebGLRenderTarget | null = null;

  const slabGeo = track(extrudedSlab(0.48, 0.14, 0.03, 0.06 - 0.016, 0.008, 3));
  const slabMat: THREE.MeshPhysicalMaterial = cfg.transmission
    ? new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        transmission: 1,
        thickness: 0.06,
        ior: 1.45,
        roughness: 0.05,
        attenuationColor: colors.ember.clone(),
        attenuationDistance: 6,
        envMapIntensity: 1.1,
        dispersion: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.06,
        transparent: true,
        opacity: 0,
        emissive: colors.ember.clone(),
        emissiveIntensity: 0.2,
      })
    : new THREE.MeshPhysicalMaterial({
        color: colors.ember.clone().lerp(colors.surface, 0.35),
        transmission: 0,
        transparent: true,
        opacity: 0,
        roughness: 0.1,
        clearcoat: 1,
        envMapIntensity: 1.3,
        emissive: colors.ember.clone(),
        emissiveIntensity: 0.1,
      });
  track(slabMat);
  const slab = new THREE.Mesh(slabGeo, slabMat);
  slab.matrixAutoUpdate = false;
  slab.visible = false;
  slab.renderOrder = 10;
  scene.add(slab);
  {
    const m = slab.matrix;
    m.makeBasis(calFrame.N, calFrame.B, new Vector3().copy(calFrame.T).negate());
    const pos = new Vector3().copy(calFrame.C).addScaledVector(calFrame.T, -0.03);
    m.setPosition(pos);
  }
  const slabBase = slab.matrix.clone();

  /* ---------- F. the dashboard plate ---------- */
  let plateRect: PlateRect | null = null,
    plateGeo: THREE.ExtrudeGeometry | null = null,
    decalGeo: THREE.PlaneGeometry | null = null,
    skelTex: THREE.CanvasTexture | null = null,
    skelCanvas: HTMLCanvasElement | null = null,
    skelKey = "";
  const plateFrame = { C: new Vector3(), N: new Vector3(), B: new Vector3(), T: new Vector3() };
  atP(S_PLATE, plateFrame.C);
  atN(S_PLATE, plateFrame.N);
  atB(S_PLATE, plateFrame.B);
  atT(S_PLATE, plateFrame.T);
  const plateMat = new THREE.MeshPhysicalMaterial({
    color: colors.surface.clone(),
    roughness: 0.34,
    metalness: 0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.25,
    envMapIntensity: 1.0,
    transparent: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    opacity: 0,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  track(plateMat);
  const decalMat = track(
    new THREE.MeshBasicMaterial({
      transparent: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      depthWrite: false,
      toneMapped: false,
      opacity: 0,
    }),
  );
  const rimU = {
    uRimHalf: { value: new Vector2(1.6, 1) },
    uRimM: { value: 0.42 },
    uRimRad: { value: 0.1 },
    uRimVis: { value: 0 },
    uSweep: { value: -0.4 },
  };
  const rimMat = reg(track(hairMaterial("platerim", PRIM_VS, PRIM_FS, shared(rimU))));
  const plateRim = new THREE.Mesh(track(new THREE.PlaneGeometry(1, 1)), rimMat);
  plateRim.matrixAutoUpdate = false;
  plateRim.frustumCulled = false;
  plateRim.visible = false;
  plateRim.renderOrder = -8;
  scene.add(plateRim);
  const plate = new THREE.Mesh(new THREE.BufferGeometry(), plateMat);
  plate.matrixAutoUpdate = false;
  plate.visible = false;
  plate.renderOrder = -10;
  scene.add(plate);
  const decal = new THREE.Mesh(new THREE.BufferGeometry(), decalMat);
  decal.matrixAutoUpdate = false;
  decal.visible = false;
  decal.renderOrder = -9;
  scene.add(decal);
  const plN = new Vector3(),
    plZ = new Vector3(),
    plM = new THREE.Matrix4();
  let plPhi = 1e9;
  function setPlateTilt(deg: number) {
    // yaw about the plate's own vertical axis, the same rotation the page gives the DOM frame
    const phi = (deg * Math.PI) / 180;
    if (Math.abs(phi - plPhi) < 1e-5) return;
    plPhi = phi;
    const c = Math.cos(phi),
      sn = Math.sin(phi);
    plN.copy(plateFrame.N).multiplyScalar(c).addScaledVector(plateFrame.T, sn);
    plZ.copy(plateFrame.N).multiplyScalar(sn).addScaledVector(plateFrame.T, -c);
    plM.makeBasis(plN, plateFrame.B, plZ);
    plM.setPosition(plateFrame.C);
    plate.matrix.copy(plM);
    decal.matrix.copy(plM).multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.0005));
    plateRim.matrix.copy(plM).multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.0012));
  }
  setPlateTilt(0);
  function rebuildPlate() {
    if (plateGeo) {
      plateGeo.dispose();
      plateGeo = null;
    }
    if (decalGeo) {
      decalGeo.dispose();
      decalGeo = null;
    }
    if (!plateRect) return;
    const asp = plateRect.w / plateRect.h,
      Wp = HP * asp,
      rad = (16 * HP) / plateRect.h;
    plateGeo = extrudedSlab(Wp, HP, rad, 0.08 - 0.03, 0.015, 4);
    plate.geometry = plateGeo;
    decalGeo = new THREE.PlaneGeometry(Wp, HP);
    decal.geometry = decalGeo;
    U.uPlHalf.value.set(Wp / 2, HP / 2);
    rimU.uRimHalf.value.set(Wp / 2, HP / 2);
    rimU.uRimRad.value = rad;
    skelKey = "";
    redrawSkeleton();
  }
  function redrawSkeleton() {
    if (!plateRect) return;
    const key = (plateRect.w / plateRect.h).toFixed(4) + tk.rule + tk.ink2;
    if (key === skelKey) return;
    skelKey = key;
    if (!skelCanvas) skelCanvas = document.createElement("canvas");
    drawSkeleton(skelCanvas, plateRect.w / plateRect.h, tk);
    if (skelTex) skelTex.dispose();
    skelTex = new THREE.CanvasTexture(skelCanvas);
    skelTex.colorSpace = THREE.SRGBColorSpace;
    skelTex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    skelTex.generateMipmaps = true;
    skelTex.minFilter = THREE.LinearMipmapLinearFilter;
    decalMat.map = skelTex;
    decalMat.needsUpdate = true;
  }

  /* ---------- G. rings ---------- */
  const ringU = { uRingVis: { value: 0 }, uRingLit: { value: new Vector3() } };
  const ringMat = reg(track(hairMaterial("rings", RING_VS, RING_FS, shared(ringU))));
  const ringGeo = track(planeInstGeom());
  const ringLit = new Float32Array(3);
  {
    const aC = new Float32Array(9),
      aN = new Float32Array(9),
      aB = new Float32Array(9);
    const t = new Vector3();
    const TILT = [58, 64, 60].map((d) => (d * Math.PI) / 180);
    const tt = new Vector3(),
      nn = new Vector3();
    RING_S.forEach((s, i) => {
      const tilt = TILT[i] ?? 0;
      atP(s, t);
      aC.set([t.x, t.y, t.z], i * 3);
      atT(s, tt);
      atN(s, nn);
      nn.multiplyScalar(Math.cos(tilt)).addScaledVector(tt, Math.sin(tilt));
      aN.set([nn.x, nn.y, nn.z], i * 3); // hoops tilted about the up axis, so they read as glass in space
      atB(s, t);
      aB.set([t.x, t.y, t.z], i * 3);
      ringLit[i] = 0.25;
    });
    ringGeo.setAttribute("aC", new THREE.InstancedBufferAttribute(aC, 3));
    ringGeo.setAttribute("aRN", new THREE.InstancedBufferAttribute(aN, 3));
    ringGeo.setAttribute("aRB", new THREE.InstancedBufferAttribute(aB, 3));
    ringGeo.setAttribute("aLit", new THREE.InstancedBufferAttribute(ringLit, 1));
    ringGeo.instanceCount = 3;
  }
  const rings = new THREE.Mesh(ringGeo, ringMat);
  rings.frustumCulled = false;
  rings.renderOrder = 7;
  rings.visible = false;
  scene.add(rings);

  /* ---------- H. dust ---------- */
  const dustU = { uDustVis: { value: 1 } };
  const dustMat = reg(track(hairMaterial("dust", DUST_VS, DUST_FS, shared(dustU))));
  let dust: THREE.Points | null = null;
  if (cfg.dust > 0) {
    const rnd = mulberry32(0x48594c4f);
    const nD = cfg.dust;
    const pos = new Float32Array(nD * 3),
      sz = new Float32Array(nD),
      al = new Float32Array(nD);
    const p = new Vector3(),
      n = new Vector3(),
      b = new Vector3();
    for (let i = 0; i < nD; i++) {
      const s = rnd();
      atP(s, p);
      atN(s, n);
      atB(s, b);
      const r = 5 * Math.sqrt(rnd()),
        a = rnd() * Math.PI * 2,
        back = (rnd() - 0.5) * 2.5;
      p.addScaledVector(n, Math.cos(a) * r).addScaledVector(b, Math.sin(a) * r);
      atT(s, n);
      p.addScaledVector(n, back);
      pos.set([p.x, p.y, p.z], i * 3);
      sz[i] = 1 + rnd();
      al[i] = 0.12 + 0.08 * rnd();
    }
    const g = track(new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(sz, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(al, 1));
    dust = new THREE.Points(g, dustMat);
    dust.frustumCulled = false;
    dust.renderOrder = 2;
    scene.add(dust);
  }

  buildEnv();
  setBlend(tk.dark);
  function setBlend(dark: boolean) {
    hair.forEach((m) => {
      m.blendSrc = dark ? THREE.OneMinusDstColorFactor : THREE.ZeroFactor;
      m.blendDst = dark ? THREE.OneFactor : THREE.SrcColorFactor;
    });
  }

  /* ---------- mask schedule ---------- */
  const MASK_KEYS_T = [0, 1.6, 2, 3.2, 4, 5, 6, 7.4, 8, 9.0, 9.4, 11.5, 12, 13];
  // [leftW, leftS, full, b1y0, b1y1, b1s, b2y0, b2y1, b2s]
  const MD = {
    hero: [0.6, 0.8, 0, 0, 0, 0, 0, 0, 0, 0, 0.06, 0.74, 0.6, 0.985],
    hours: [0.48, 0.75, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    call: [0.56, 1.0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    dash: [0.4, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    trades: [0, 0, 0, 0, 0.71, 0.97, 0.93, 1, 0.92, 0, 0, 0, 0, 0],
    setup: [0.62, 1.0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    finale: [0, 0, 0.45, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
  const MM = {
    hero: [0, 0, 0, 0, 0.24, 0.85, 0.52, 1, 0.94, 0, 0, 0, 0, 0],
    hours: [0, 0, 0, 0, 0.24, 0.8, 0.56, 1, 0.95, 0, 0, 0, 0, 0],
    call: [0, 0, 0, 0, 0.24, 0.85, 0.56, 1, 0.9, 0, 0, 0, 0, 0],
    dash: [0, 0, 0.7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    trades: [0, 0, 0.88, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    setup: [0, 0, 0.9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    finale: [0, 0, 0.7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
  const MASK_ORDER = [
    "hero",
    "hero",
    "hours",
    "hours",
    "call",
    "call",
    "dash",
    "dash",
    "trades",
    "trades",
    "setup",
    "setup",
    "finale",
    "finale",
  ] as const;
  const maskOut = new Float32Array(14);
  function maskAt(T: number, mobile: boolean) {
    const tab: Record<(typeof MASK_ORDER)[number], number[]> = mobile ? MM : MD;
    let k = 0;
    while (k < MASK_KEYS_T.length - 2 && T > at(MASK_KEYS_T, k + 1)) k++;
    const a = tab[MASK_ORDER[k] ?? "hero"],
      b = tab[MASK_ORDER[k + 1] ?? "hero"];
    const t = sstep(at(MASK_KEYS_T, k), at(MASK_KEYS_T, k + 1), T);
    for (let i = 0; i < 14; i++) maskOut[i] = mix(at(a, i), at(b, i), t);
    return maskOut;
  }

  /* ---------- camera rig ---------- */
  // [sHead, back, lat, lift, ahead, lookLift, fov, roll, shiftX, shiftY, lookLat]
  const KEYS: number[][] = [
    [0.062, 14, -12, 6, 5.9, 0.32, 27, -3, 0.49, 0, 2],
    [0.07, 13.4, -11.5, 5.8, 6.2, 0.32, 27, -3, 0.49, 0, 2],
    [0.078, 9, -0.4, 1.1, 1.0, -0.35, 32, 0, 0.2, 0],
    [0.094, 8.6, -0.4, 1.1, 1.0, -0.35, 32, 0, 0.2, 0],
    [0.1, 3.4, 1.1, 0.25, 2.8, 0, 34, -2, 0.16, 0],
    [0.477, 2.6, 0, 0, 1.5, 0, 28, 0, 0.14, 0],
    [0.56, 9, 0.9, 0.35, 0, 0, 26, 2, 0, 0],
    [0.56, 6.7, 0, 0, 0, 0, 26, 0, 0, 0],
    [0.64, 10, 8, 2, 6, 0, 40, 0, 0.22, 0.3, 0],
    [0.72, 10, 8, 2, 6, 0, 40, 0, 0.22, 0.3, 0],
    [0.78, 4.6, 0.6, 0.3, 3.5, 0, 32, 0, 0.18, 0],
    [0.86, 4.6, 0.6, 0.3, 3.5, 0, 32, 0, 0.18, 0],
    [0.905, 12, -3.5, 2.0, 9, 0, 30, 0, 0.16, 0],
    [0.96, 13.5, -3.5, 2.4, 9, 0, 30, 0, 0.16, 0],
  ];
  const CALL_BACK0 = 7,
    CALL_BACK1 = 10,
    CALL_LAT = 0.7,
    CALL_LIFT = 1.6,
    CALL_AHEAD = 2,
    CALL_LAT0 = 4.5;
  const pose = new Float64Array(11);
  let corrW = 0;
  const corr = new Vector3(),
    frontalPos = new Vector3();
  const vp = { w: cssW, h: cssH };
  let dFront = 6.7,
    shFrontX = 0,
    shFrontY = 0;
  const fovMul = () => 1 + 0.35 * sstep(1.4, 0.6, vp.w / vp.h);
  function updateDashKeys() {
    const k6 = KEYS[6] ?? [],
      k7 = KEYS[7] ?? [];
    const fe = 26 * fovMul();
    if (plateRect) {
      dFront = (HP * vp.h) / (2 * plateRect.h * Math.tan((fe * Math.PI) / 360));
      shFrontX = (plateRect.x + plateRect.w / 2 - vp.w / 2) / vp.w;
      shFrontY = (plateRect.y + plateRect.h / 2 - vp.h / 2) / vp.h;
      frontalPos.copy(plateFrame.C).addScaledVector(plateFrame.T, -dFront);
      atP(S_PLATE - dFront / L, corr);
      corr.multiplyScalar(-1).add(frontalPos);
    } else {
      dFront = 6.7;
      shFrontX = 0;
      shFrontY = 0;
      corr.set(0, 0, 0);
    }
    const set = (k: number[], v: ArrayLike<number>) => {
      for (let i = 0; i < 11; i++) k[i] = v[i] || 0;
    };
    set(k7, [S_PLATE, dFront, 0, 0, 0, 0, 26, 0, shFrontX, shFrontY, 0]);
    set(k6, [S_PLATE, dFront * 1.35, 0.9, 0.35, 0, 0, 26, 2, shFrontX * 0.6, shFrontY * 0.6, 0]);
    if (!plateRect) set(k7, k6);
  }
  function lerpKey(a: ArrayLike<number>, b: ArrayLike<number>, t: number, out: Float64Array) {
    for (let i = 0; i < 11; i++) out[i] = mix(a[i] || 0, b[i] || 0, t);
  }
  function speakerBias(c: number) {
    if (!utter.length || c < 0.3) return 1;
    let b = 0;
    for (const u of utter)
      b +=
        (u.spk === 0 ? 1 : -1) *
        (sstep(u.t0 - 0.5, u.t0 + 0.3, c) - sstep(u.t1 + 0.2, u.t1 + 0.9, c));
    return clamp(b, -1, 1);
  }
  function callPose(c: number, out: number[] | Float64Array) {
    const b = speakerBias(c),
      bk = sstep(31, 54, c);
    out[0] = sOfT(c);
    out[1] = mix(CALL_BACK0, CALL_BACK1, bk);
    out[2] = (CALL_LAT0 + CALL_LAT * b) * (1 - bk);
    out[3] = mix(CALL_LIFT, 0, bk);
    out[4] = mix(CALL_AHEAD, 1.5, bk);
    out[5] = 0;
    out[6] = mix(34, 28, bk);
    out[7] = -2 * b * (1 - bk);
    out[8] = mix(0.16, 0.27, bk);
    out[9] = 0.11 * sstep(14, 26, c);
    out[10] = 0;
  }
  function syncCallKeys() {
    callPose(0, KEYS[4] ?? []);
    callPose(CALL_SECONDS, KEYS[5] ?? []);
  }
  function poseAt(Tin: number, out: Float64Array) {
    // fills `out` (11) and returns the corrW
    const T = clamp(Tin, 0, 13);
    const k = Math.min(12, Math.floor(T)),
      f = T - k;
    const ka = KEYS[k] ?? [],
      kb = KEYS[k + 1] ?? [];
    let cw = 0;
    if (k === 4) {
      callPose(callClock(f), out);
    } else if (k === 6) {
      const settle = sstep5(0, DASH_SETTLE_END, f);
      lerpKey(ka, kb, settle, out);
      cw = settle;
    } else if (k % 2 === 0) {
      lerpKey(ka, kb, f, out);
    } else {
      const e = sstep5(0, 1, f);
      lerpKey(ka, kb, e, out);
      if (k === 7) cw = 1 - e;
    }
    return cw;
  }

  /* ---------- state ---------- */
  const seg = new Float32Array(13);
  let Ttarget = 0,
    Tcur = 0,
    Tvel = 0,
    ptrX = 0,
    ptrY = 0,
    ptrTX = 0,
    ptrTY = 0;
  let dirty = true,
    running = false,
    rafId = 0,
    hidden = document.hidden,
    paused = false,
    offscreen = false,
    destroyed = false,
    lost = false;
  let introDone = false,
    lastT = 0,
    firstFrameSent = false,
    idle = false,
    fps = 60,
    emaMs = 16,
    slowCount = 0,
    dropCount = 0,
    introStart = -1;
  let ember = 0,
    dimT = 1,
    dimCur = 1;
  const themeFade = { active: false, t: 0, switched: false, alpha: 1 };
  const camPos = new Vector3(),
    camTgt = new Vector3(),
    camUp = new Vector3(),
    tmpA = new Vector3(),
    tmpB = new Vector3(),
    fwd = new Vector3(),
    rgt = new Vector3(),
    upv = new Vector3(),
    headP = new Vector3();
  let Tsm = 0; // the T used for the current frame
  let stillMode = still;

  function computeT() {
    let t = 0;
    for (let i = 0; i < 13; i++) t += at(seg, i);
    return t;
  }

  function applyCamera(T: number) {
    const mobile = !(vp.w >= 900 && vp.h >= 560);
    const aspect = vp.w / vp.h;
    const pf = sstep(1.4, 0.6, aspect);
    let P: ArrayLike<number>;
    if (stillMode) {
      P = STILL_POSE;
      corrW = 0;
    } else {
      corrW = poseAt(T, pose);
      P = pose;
    }
    const sHead = at(P, 0);
    let back = at(P, 1) * (1 + 0.15 * pf);
    if (pf > 0) back *= 1 - 0.22 * pf * (stillMode ? 1 : 1 - sstep(0.5, 1.3, T)); // phones: a larger swell in the hero band
    if (!stillMode && pf > 0)
      back *=
        1 +
        0.55 *
          pf *
          sstep(4.35, 4.6, T) *
          (1 -
            sstep(5.05, 5.6, T)); /* phones: the calendar stays a small object above the caption */
    if (!stillMode)
      back *=
        1 +
        0.45 *
          sstep(1.55, 1.3, aspect) *
          (1 - pf) *
          sstep(4.35, 4.6, T) *
          (1 - sstep(5.05, 5.6, T)); // squarer windows (tablet landscape): the calendar stays inside the free column
    const lat = at(P, 2),
      lift = at(P, 3),
      ahead = at(P, 4),
      lookLift = at(P, 5),
      lookLat = at(P, 10);
    const fov = at(P, 6) * fovMul();
    const roll = at(P, 7);
    let shx = at(P, 8) * (1 - pf),
      shy = at(P, 9);
    if (pf > 0 && T < 5.4) shy += -(0.1 - 0.07 * (stillMode ? 1 : 1 - sstep(0.5, 1.3, T))) * pf;
    if (pf > 0) shx += 0.26 * pf * (1 - sstep(0.5, 1.0, T)); // phones: the swell sits centred between the headline and the copy
    shx +=
      0.09 * sstep(1.75, 1.3, aspect) * (1 - pf) * sstep(4.5, 4.95, T) * (1 - sstep(5.0, 5.4, T));
    const sc = sHead - back / L,
      sa = sHead + ahead / L;
    atP(sc, camPos);
    atN(sc, tmpA);
    atB(sc, tmpB);
    camPos.addScaledVector(tmpA, lat).addScaledVector(tmpB, lift);
    if (corrW > 0) camPos.addScaledVector(corr, corrW);
    atP(sa, camTgt);
    atB(sa, tmpB);
    camTgt.addScaledVector(tmpB, lookLift);
    atN(sa, tmpB);
    camTgt.addScaledVector(tmpB, lookLat);
    atB(sHead, camUp);
    // pointer (fine pointers only; gain zero while the dashboard is read)
    if (!stillMode) {
      const g = 1 - sstep(6.15, 6.35, T) * (1 - sstep(7.0, 7.4, T));
      if (g > 0.001 && (Math.abs(ptrX) > 1e-4 || Math.abs(ptrY) > 1e-4)) {
        fwd.copy(camTgt).sub(camPos).normalize();
        rgt.crossVectors(fwd, camUp).normalize();
        upv.crossVectors(rgt, fwd).normalize();
        tmpA
          .copy(rgt)
          .multiplyScalar(0.12 * ptrX * g)
          .addScaledVector(upv, 0.08 * ptrY * g);
        camPos.add(tmpA);
        camTgt.addScaledVector(tmpA, 0.5);
      }
    }
    camera.position.copy(camPos);
    camera.up.copy(camUp);
    camera.lookAt(camTgt);
    if (roll) camera.rotateZ((roll * Math.PI) / 180);
    camera.fov = fov;
    camera.aspect = aspect;
    camera.setViewOffset(vp.w, vp.h, -shx * vp.w, -shy * vp.h, vp.w, vp.h);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    return { sHead, mobile };
  }

  const beadColor = new Color();
  function applyState(T: number) {
    const c = stillMode ? CALL_SECONDS : callClock(clamp(T - 4, 0, 1));
    const { sHead, mobile } = applyCamera(T);
    atP(sHead, headP);
    const camDist = camPos.distanceTo(headP);
    // theme fade
    const fadeA = themeFade.alpha;
    const calm = stillMode
      ? 0.75
      : mix(1, 0.55, sstep(11, 12, T)) *
        (1 - 0.88 * sstep(7.0, 7.3, T) * (1 - sstep(7.8, 8.0, T))) *
        (1 - 0.8 * sstep(5.95, 6.15, T) * (1 - sstep(6.85, 7.05, T))); // the thread steps back while it crosses the dashboard frame
    strandU.uHead.value = sHead;
    strandU.uGhost.value =
      (tk.dark ? 0.3 : 0.28) *
      (stillMode ? 1 : mix(1, 0.08, sstep(1.2, 1.8, T) * (1 - sstep(3.4, 3.9, T)))); // the upcoming call stays faint while the week is read
    strandU.uFocus.value = camDist;
    {
      const fn = Math.max(18, camDist * 1.6);
      U.uFog.value.set(fn, fn + 28);
    }
    strandU.uAlpha.value = calm * fadeA * dimCur;
    strandU.uTaper.value = stillMode
      ? 0.8
      : mix(mix(0.8, 0.3, sstep(0.6, 1.4, T)), 0.6, sstep(5.2, 6.4, T));
    strandU.uAF.value = stillMode ? 0 : mix(mix(0, 12, sstep(0.6, 1.4, T)), 6, sstep(5.2, 6.4, T));
    const fan = stillMode ? 0 : sstep(7.2, 8.2, T) - sstep(8.6, 9.25, T);
    strandU.uFan.value = fan;
    strandU.uSwell.value = stillMode ? 0.6 : 1 - 0.55 * sstep(40, 50, c) * (1 - sstep(6.4, 7.2, T)); // the booked beat: the swell settles into a slim, tapering tip
    strandU.uFar.value = stillMode
      ? 1
      : 1 - sstep(3.5, 4.3, T) + 0.35 * sstep(3.5, 4.3, T) * (1 - sstep(5, 5.6, T));
    const idx = clamp(clamp(T - 8, 0, 1) * 8 - 0.5, 0, 7);
    strandU.uLaneIdx.value = idx;
    // mask
    const m = maskAt(stillMode ? 0.5 : T, mobile);
    U.uMaskMix.value = mobile ? 0.85 : 0.3;
    U.uMaskA.value.set(at(m, 0), stillMode ? Math.max(at(m, 1), 0.88) : at(m, 1), at(m, 2), 0);
    if (stillMode && mobile) {
      m[3] = 0.1;
      m[4] = 0.36;
      m[5] = 0.85;
    }
    U.uMaskB1.value.set(at(m, 3), at(m, 4), at(m, 5));
    U.uMaskB2.value.set(at(m, 6), at(m, 7), at(m, 8));
    if (mobile) {
      U.uMaskRS.value = 0;
    } else {
      U.uMaskR.value.set(at(m, 9), at(m, 10), at(m, 11), at(m, 12));
      U.uMaskRS.value = at(m, 13);
    }
    // bead
    let bv = 0,
      emberCol = 1;
    if (!stillMode) {
      const a =
        sstep(0.12, 0.17, T) *
        (1 - sstep(1.35, 1.7, T) * (1 - sstep(3.0, 3.4, T))) *
        (1 - sstep(4.897, 4.947, T)) *
        (mobile ? 1 : 1 - sstep(54, 57, callClock(clamp(T - 4, 0, 1))));
      const b = sstep(9.8, 10.0, T); // one ember per view: the bead steps aside when the slab lands
      bv = Math.max(a, b);
      emberCol = T < 6 ? 1 : sstep(10.78, 10.88, T);
    }
    if (mobile) bv *= 1 - sstep(11.5, 11.9, T);
    bv *= dimCur;
    beadU.uPos.value.copy(headP);
    beadU.uAlpha.value = bv * fadeA;
    bead.visible = bv * fadeA > 0.002;
    beadColor.copy(U.uFilament.value).lerp(colors.ember, emberCol);
    beadU.uCol.value.copy(beadColor);
    // tokens
    if (tokens) {
      const tv =
        stillMode || mobile
          ? 0
          : sstep(3.5, 4.0, T) *
            (1 - sstep(5.02, 5.4, T)) *
            (1 - sstep(44, 50, c) * (T >= 4 ? 1 : 0));
      tokU.uClock.value = c;
      tokU.uTokVis.value = tv * fadeA;
      tokens.visible = tv * fadeA > 0.002;
    }
    // lattice
    const lv = stillMode ? 0 : sstep(1.3, 2.0, T) * (1 - sstep(2.9, 3.3, T));
    const ph = clamp(T - 2, 0, 1);
    latU.uSweep.value = 168 * ph;
    latU.uDone.value = sstep(0.9, 0.95, ph);
    latU.uLatVis.value = lv * fadeA;
    lattice.visible = lv * fadeA > 0.002;
    latLab.visible = lattice.visible;
    // calendar
    const linkQ = clamp(T - 5, 0, 1);
    const calFade = stillMode ? 0 : T < 4 ? 0 : (1 - sstep(0.0, 0.32, linkQ)) * sstep(15, 25, c);
    calU.uCalCells.value = sstep(20, 31, c);
    calU.uCalTarget.value = sstep(31, 34, c);
    calU.uCalEdge.value = 0.6 * sstep(42, 52, c) + 0.4 * sstep(50, 54, c);
    calU.uEmberMix.value = stillMode ? 1 : sstep(54, 57, c);
    calU.uEmber.value.copy(colors.ember);
    const tiny = mobile && vp.h < 640; // a very short phone has no free band for the calendar
    calU.uCalVis.value =
      (T < 4 && !stillMode ? 0 : calFade) *
      fadeA *
      (tiny ? 0 : 1) *
      (mobile ? 1 - sstep(47, 52, c) : 1); // on phones the band is too short once the text message lands: the calendar steps aside
    calendar.visible =
      calU.uCalVis.value > 0.002 && (stillMode || (T >= 4 && T < 5.6)) && (c > 10 || stillMode);
    calPlate.visible = calendar.visible;
    // slab
    const uSlab = stillMode ? 1 : sstep(54, 57, c) * (T < 5 ? 1 : 1 - sstep(0, 0.32, linkQ));
    const slabVisible = stillMode ? false : c >= 53 && T < 5.6 && uSlab > 0.002 && !mobile;
    slab.visible = slabVisible && fadeA > 0.01;
    if (slab.visible) {
      const sc = stillMode
        ? 1
        : T < 5
          ? mix(0.6, 1.0, sstep(54, 57, c))
          : mix(1.0, 1.35, sstep(0, 0.32, linkQ));
      slab.matrix.copy(slabBase).scale(tmpA.set(sc, sc, sc));
      slabMat.opacity = uSlab * fadeA;
      const sweep = sstep(54.5, 57.5, c);
      slabMat.envMapRotation.set(ptrY * 0.06, mix(-0.42, 0.2, sweep) + ptrX * 0.15, 0);
      const d = camPos.distanceTo(calFrame.C);
      slabMat.opacity *= sstep(0.35, 1.5, d);
    }
    // plate
    let pv = 0;
    if (plateRect && !stillMode) pv = sstep(5.35, 5.9, T) * (1 - sstep(6.78, 6.98, T)); // the frame's rim is gone before the dashboard starts to scroll away
    const dPlate = camPos.distanceTo(plateFrame.C);
    const nearP = sstep(0.35, 1.5, dPlate);
    const pOp = pv * nearP * fadeA;
    const dOp = pOp * (1 - sstep(6.06, 6.14, T)); // strict hand-off: the skeleton is gone before the real dashboard is a third visible
    plate.visible = pOp > 0.002 && !!plateRect;
    decal.visible = dOp > 0.002 && !!plateRect;
    plateMat.opacity = pOp;
    decalMat.opacity = dOp;
    plateMat.envMapRotation.set(ptrY * 0.06, ptrX * 0.15 + mix(-0.4, 0.4, sstep(5.4, 7.4, T)), 0);
    rimU.uRimVis.value = pOp;
    rimU.uSweep.value = mix(-0.4, 1.4, sstep(5.7, 7.6, T));
    plateRim.visible = pOp > 0.002 && !!plateRect;
    setPlateTilt(stillMode ? 0 : DASH_TILT * (1 - sstep(5.6, 6.9, T)));
    U.uPlVis.value = pOp;
    U.uPlC.value.copy(plateFrame.C);
    U.uPlF.value.copy(plZ);
    U.uPlN.value.copy(plN);
    U.uPlB.value.copy(plateFrame.B);
    // rings
    const rv = stillMode ? 0 : sstep(9.4, 10.0, T) * (1 - sstep(10.95, 11.4, T));
    {
      let last = -1;
      for (let i = 0; i < 3; i++) {
        const rs = at(RING_S, i);
        const lit = mix(0.25, 0.8, sstep(rs - 0.012, rs + 0.004, sHead));
        ringLit[i] = lit;
        if (lit > 0.7) last = i;
      }
      if (last >= 0) ringLit[last] = 1.0;
    }
    ringGeo.getAttribute("aLit").needsUpdate = true;
    ringU.uRingVis.value = rv * fadeA;
    rings.visible = rv * fadeA > 0.002;
    // dust
    if (dust) dustU.uDustVis.value = fadeA;
    // ember bookkeeping
    const emberBead = bead.visible && beadU.uAlpha.value > 0.5 && emberCol > 0.5;
    ember =
      emberBead ||
      (slab.visible && slabMat.opacity > 0.3) ||
      (lattice.visible &&
        latU.uLatVis.value > 0.3 &&
        latU.uDone.value < 0.5 &&
        latU.uSweep.value > 0.5)
        ? 1
        : 0;
    // environment rotation for other physical materials handled per-material
    strandU.uWidthPx.value = 1.3 * dpr;
    haloU.uWidthPx.value = 5 * dpr;
    latU.uWidthPx.value = 1.7 * dpr;
    latU.uEmber.value.copy(colors.ember);
    beadU.uRadiusPx.value = 30 * dpr;
  }

  /* ---------- size ---------- */
  function applySize(force: boolean) {
    const w = Math.max(1, canvas.clientWidth),
      h = Math.max(1, canvas.clientHeight);
    if (!force && w === cssW && Math.abs(h - cssH) < 120) return false;
    if (!force && w === cssW && h === cssH) return false;
    cssW = w;
    cssH = h;
    vp.w = w;
    vp.h = h;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    U.uRes.value.set(w * dpr, h * dpr);
    U.uDpr.value = dpr;
    updateDashKeys();
    return true;
  }
  updateDashKeys();
  syncCallKeys();

  /* ---------- rendering ---------- */
  function renderNow() {
    applyState(Tsm);
    renderer.render(scene, camera);
    if (!firstFrameSent) {
      firstFrameSent = true;
      opts.onFirstFrame?.();
      schedulePrecompile();
    }
  }
  /* compile every material once, in parallel, right after the first frame. Nothing compiles mid-scroll later. */
  let compiled = false;
  function schedulePrecompile() {
    if (compiled) return;
    compiled = true;
    const go = () => {
      precompile().catch(() => {});
    };
    setTimeout(go, 0); // right after the first frame, before any scroll can reach an uncompiled program
  }
  async function precompile() {
    if (destroyed || lost || !renderer.compileAsync) return;
    const objs = [
      strands,
      halo,
      sheet,
      bead,
      tokens,
      lattice,
      latLab,
      calendar,
      calPlate,
      slab,
      plate,
      decal,
      plateRim,
      rings,
      dust,
    ].filter((o): o is NonNullable<typeof o> => !!o);
    const prev = objs.map((o) => o.visible);
    objs.forEach((o) => {
      o.visible = true;
    });
    let p: Promise<unknown> | null = null;
    try {
      if (renderer.extensions.has("KHR_parallel_shader_compile"))
        p = renderer.compileAsync(scene, camera); // parallel where the driver allows it
      else renderer.compile(scene, camera); // otherwise one synchronous pass, still before any scroll
    } finally {
      objs.forEach((o, i) => {
        o.visible = prev[i] ?? false;
      });
    } // the traversal happens synchronously
    if (p) await p;
    if (destroyed || lost) return;
    /* one scissored warm-up frame with everything on, so the transmission pass variants and every first draw happen now.
       (Transmission renders the opaque hair materials into an offscreen target, which is a second program per material.) */
    const cull = slab.frustumCulled;
    slab.frustumCulled = false;
    objs.forEach((o, i) => {
      prev[i] = o.visible;
      o.visible = true;
    });
    try {
      renderer.setScissorTest(true);
      renderer.setScissor(0, 0, 1, 1);
      renderer.render(scene, camera);
    } catch (e) {
      /* ignore */
    } finally {
      renderer.setScissorTest(false);
      slab.frustumCulled = cull;
      objs.forEach((o, i) => {
        o.visible = prev[i] ?? false;
      });
    }
    if (destroyed || lost) return;
    dirty = true;
    if (stillMode) stillRender();
    else {
      renderNow();
      kick();
    } // repaint straight away, so the scissored frame is never presented
  }

  function stepTheme(dt: number) {
    if (!themeFade.active) {
      themeFade.alpha = 1;
      return;
    }
    themeFade.t = Math.min(1, themeFade.t + dt / 0.6);
    const e = themeFade.t;
    if (e < 0.5) themeFade.alpha = 1 - easeUI(e * 2);
    else themeFade.alpha = easeUI((e - 0.5) * 2);
    if (e >= 0.5 && !themeFade.switched) {
      themeFade.switched = true;
      commitTheme();
    }
    // clear colour lerps across the whole fade
    const gk = new Color(tkFrom.ground).lerp(new Color(tk.ground), easeUI(e));
    renderer.setClearColor(gk, 1);
    if (e >= 1) {
      themeFade.active = false;
      themeFade.alpha = 1;
      renderer.setClearColor(colors.ground, 1);
    }
  }
  function commitTheme() {
    colors.ground.set(tk.ground);
    colors.surface.set(tk.surface);
    colors.rule.set(tk.rule);
    colors.ink.set(tk.ink);
    colors.ink2.set(tk.ink2);
    colors.filament.set(tk.filament);
    colors.ember.set(tk.ember);
    U.uFilament.value.copy(colors.filament);
    U.uInk2.value.copy(colors.ink2);
    U.uDark.value = tk.dark ? 1 : 0;
    renderer.toneMappingExposure = tk.dark ? 1.0 : 0.95;
    setBlend(tk.dark);
    halo.visible = cfg.halo && tk.dark && haloOn; // in light theme the sheet and strands multiply, the halo stays off
    plateMat.color.copy(colors.surface);
    slabMat.attenuationColor.copy(colors.ember);
    slabMat.emissive.copy(colors.ember);
    if (!cfg.transmission) slabMat.color.copy(colors.ember).lerp(colors.surface, 0.35);
    buildEnv();
    redrawSkeleton();
  }
  let haloOn = cfg.halo;

  function tick(now: number) {
    rafId = 0;
    if (destroyed || lost) return;
    if (hidden || paused || offscreen) {
      running = false;
      return;
    }
    const dt = Math.min(0.1, lastT ? (now - lastT) / 1000 : 1 / 60);
    lastT = now;
    let moving = false;
    // spring on T
    if (!stillMode) {
      const w = 9;
      const x = Tcur - Ttarget,
        v = Tvel;
      const e = Math.exp(-w * dt);
      let nx = (x + (v + w * x) * dt) * e,
        nv = (v - w * (v + w * x) * dt) * e;
      const dx = Ttarget + nx - Tcur,
        lim = 3.2 * dt;
      if (Math.abs(dx) > lim) {
        nx = x + Math.sign(dx) * lim;
        nv = Math.sign(dx) * 3.2 * 0.5;
      }
      Tcur = Ttarget + nx;
      Tvel = nv;
      if (Math.abs(Tcur - Ttarget) < 1e-4 && Math.abs(Tvel) < 1e-3) {
        Tcur = Ttarget;
        Tvel = 0;
      }
      moving = Tcur !== Ttarget || Tvel !== 0;
      Tsm = Tcur;
    }
    // pointer damping
    if (!stillMode) {
      const k = 1 - Math.exp(-dt * 5);
      ptrX += (ptrTX - ptrX) * k;
      ptrY += (ptrTY - ptrY) * k;
      if (Math.abs(ptrTX - ptrX) < 1e-4 && Math.abs(ptrTY - ptrY) < 1e-4) {
        ptrX = ptrTX;
        ptrY = ptrTY;
      } else moving = true;
    }
    // intro
    if (!stillMode && !introDone && introStart >= 0) {
      const p = clamp((now - introStart) / 2600, 0, 1);
      strandU.uReveal.value = easeInOut4(p) * 1.9;
      if (p < 1) moving = true;
      else introDone = true;
    }
    if (themeFade.active) {
      stepTheme(dt);
      moving = true;
    }
    if (Math.abs(dimT - dimCur) > 0.002) {
      dimCur += (dimT - dimCur) * (1 - Math.exp(-dt * 6));
      moving = true;
    } else dimCur = dimT;
    if (dirty || moving) {
      if (introStart < 0 && !stillMode) {
        introStart = now;
      }
      dirty = false;
      idle = false;
      renderNow();
      // adaptive resolution (one-way ratchet)
      if (adaptive) {
        const ms = dt * 1000;
        emaMs = mix(emaMs, ms, 0.1);
        fps = 1000 / Math.max(emaMs, 1);
        if (moving && emaMs > 22) {
          slowCount++;
        } else slowCount = 0;
        if (slowCount > 30) {
          slowCount = 0;
          adaptStep();
        }
      }
      rafId = requestAnimationFrame(tick);
      running = true;
    } else {
      idle = true;
      running = false;
      lastT = 0;
    }
  }
  function adaptStep() {
    if (haloOn) {
      haloOn = false;
      halo.visible = false;
      return;
    }
    if (dpr > 1.0) {
      dpr = Math.max(1.0, dpr - 0.25);
      applySize(true);
      dirty = true;
      return;
    }
    dropCount++;
    if (dropCount >= 3 && tier !== "low") {
      tier = "low";
      setStrandCount(4);
      sheet.visible = false;
      if (dust) dust.visible = false;
      dirty = true;
    }
  }
  function kick() {
    dirty = true;
    idle = false;
    if (stillMode) {
      if (!destroyed && !lost) {
        stillRender();
      }
      return;
    }
    if (!running && !rafId && !hidden && !paused && !offscreen && !lost && !destroyed) {
      running = true;
      rafId = requestAnimationFrame(tick);
    }
  }
  function stillRender() {
    Tsm = 0;
    if (!lost && !destroyed) {
      renderNow();
      dirty = false;
      idle = true;
    }
  }

  /* ---------- context loss ---------- */
  let lostTimer: ReturnType<typeof setTimeout> | undefined;
  const onLost = (e: Event) => {
    e.preventDefault();
    lost = true;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    running = false;
    clearTimeout(lostTimer);
    lostTimer = setTimeout(() => {
      if (lost) opts.onError?.("webgl context lost");
    }, 3000);
  };
  const onRestored = () => {
    clearTimeout(lostTimer);
    lost = false;
    try {
      rebuildAfterRestore();
    } catch (err) {
      opts.onError?.(String(err));
      return;
    }
    firstFrameSent = false;
    compiled = false;
    offscreen = false;
    dirty = true;
    kick();
  }; // the next frame re-announces itself, so the page brings the canvas back
  function rebuildAfterRestore() {
    // three re-uploads geometries and textures lazily; the PMREM target and canvas texture must be rebuilt
    pmrem = new THREE.PMREMGenerator(renderer);
    envTex = null;
    envRT = null;
    oldRT = null;
    skelTex = null;
    labTex = null;
    calU.uLab.value = null;
    latTex = null;
    latLabU.uLatTex.value = null;
    buildEnv();
    skelKey = "";
    redrawSkeleton();
    drawCalLabels();
    drawLatLabels(); // handles from the dead context are dropped, never disposed
    renderer.setSize(cssW, cssH, false);
  }
  canvas.addEventListener("webglcontextlost", onLost, false);
  canvas.addEventListener("webglcontextrestored", onRestored, false);

  const onVis = () => {
    hidden = document.hidden;
    if (!hidden) {
      lastT = 0;
      kick();
    }
  };
  document.addEventListener("visibilitychange", onVis);
  let io: IntersectionObserver | null = null;
  if (typeof IntersectionObserver !== "undefined") {
    io = new IntersectionObserver((es) => {
      const last = es[es.length - 1];
      if (!last) return;
      const v = last.isIntersecting;
      offscreen = !v;
      if (v) {
        lastT = 0;
        kick();
      }
    });
    io.observe(canvas);
  }

  /* ---------- controller ---------- */
  const ctrl: SceneController = {
    get tier() {
      return stillMode ? "still" : tier;
    },
    setProgress(id, p) {
      const i = SEG_INDEX[id];
      if (i === undefined || stillMode) return;
      const v = clamp(+p || 0, 0, 1);
      if (seg[i] === v) return;
      seg[i] = v;
      Ttarget = computeT();
      kick();
    },
    setCopyBands(bands, vh) {
      const a = U.uCopy.value;
      let n = 0;
      if (vh > 0 && !stillMode)
        for (let i = 0; i < bands.length && n < 6; i++) {
          const band = bands[i];
          const slot = a[n];
          if (!band || !slot) break;
          slot.set(clamp(band[0] / vh, 0, 1), clamp(band[1] / vh, 0, 1), 0.85);
          n++;
        }
      for (let i = n; i < 6; i++) a[i]?.set(0, 0, 0);
      kick();
    },
    setDim(v) {
      dimT = clamp(+v, 0, 1);
      if (stillMode) return;
      kick();
    },
    setPointer(x, y) {
      if (stillMode) return;
      ptrTX = clamp(+x || 0, -1, 1);
      ptrTY = clamp(+y || 0, -1, 1);
      kick();
    },
    setTheme(t) {
      const n = normTokens(t);
      tkFrom = tk;
      tk = n;
      if (stillMode) {
        commitTheme();
        renderer.setClearColor(colors.ground, 1);
        halo.visible = false;
        kick();
        return;
      }
      themeFade.active = true;
      themeFade.t = 0;
      themeFade.switched = false;
      kick();
    },
    setPlateRect(r) {
      const next = r && r.w > 1 && r.h > 1 ? { x: +r.x, y: +r.y, w: +r.w, h: +r.h } : null;
      const same =
        (!next && !plateRect) ||
        (next &&
          plateRect &&
          Math.abs(next.w / next.h - plateRect.w / plateRect.h) < 1e-4 &&
          Math.abs(next.h - plateRect.h) < 0.01);
      plateRect = next;
      if (!same) rebuildPlate();
      updateDashKeys();
      kick();
    },
    resize() {
      if (destroyed) return;
      if (applySize(false)) kick();
    },
    pause() {
      paused = true;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      running = false;
    },
    resume() {
      paused = false;
      lastT = 0;
      kick();
    },
    snap() {
      Tcur = Ttarget;
      Tvel = 0;
      Tsm = Tcur;
      strandU.uReveal.value = 1.9;
      introDone = true;
      themeFade.active = false;
      themeFade.alpha = 1;
      kick();
    },
    destroy(keepContext) {
      if (destroyed) return;
      destroyed = true;
      if (rafId) cancelAnimationFrame(rafId);
      clearTimeout(lostTimer);
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      if (io) io.disconnect();
      gpu.forEach((o) => {
        try {
          o.dispose();
        } catch (e) {
          /* ignore */
        }
      });
      [plateGeo, decalGeo, skelTex, envRT, oldRT, slabGeo].forEach((o) => {
        try {
          o?.dispose();
        } catch (e) {
          /* ignore */
        }
      });
      try {
        pmrem.dispose();
        renderer.dispose();
        if (keepContext !== true) renderer.forceContextLoss();
      } catch (e) {
        /* ignore */
      }
      if (current === ctrl) current = null;
    },
    debug() {
      const info = renderer.info.render;
      let pr: PlateRect | null = null;
      if (plateRect && plate.visible) {
        const hw = (HP * plateRect.w) / plateRect.h / 2,
          hh = HP / 2;
        let x0 = 1e9,
          y0 = 1e9,
          x1 = -1e9,
          y1 = -1e9;
        for (const sx of [-1, 1])
          for (const sy of [-1, 1]) {
            tmpA
              .copy(plateFrame.C)
              .addScaledVector(plateFrame.N, sx * hw)
              .addScaledVector(plateFrame.B, sy * hh)
              .project(camera);
            const px = (tmpA.x * 0.5 + 0.5) * vp.w,
              py = (1 - (tmpA.y * 0.5 + 0.5)) * vp.h;
            x0 = Math.min(x0, px);
            x1 = Math.max(x1, px);
            y0 = Math.min(y0, py);
            y1 = Math.max(y1, py);
          }
        pr = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      }
      return {
        T: Tsm,
        tier: stillMode ? "still" : tier,
        dpr,
        calls: info.calls,
        triangles: info.triangles,
        frame: renderer.info.render.frame,
        fps,
        idle: idle && !dirty,
        ember,
        plate: pr,
      };
    },
  };

  {
    // the lattice plane faces the camera of the hours chapter (T = 2.5), so every bar is vertical on screen
    const oldStill = stillMode;
    stillMode = false;
    applyCamera(2.5);
    stillMode = oldStill;
    const m = camera.matrixWorld;
    latFrame.R.setFromMatrixColumn(m, 0).normalize();
    latFrame.D.setFromMatrixColumn(m, 1).normalize();
    if (latPair) latFrame.R.multiplyScalar(LAT_SQ); // phones: the week is narrower, so every bar and label fits the screen
  }
  /* ---------- go ---------- */
  ptrX = ptrY = 0;
  if (stillMode) {
    Tsm = 0;
    kick();
  } else {
    Tsm = 0;
    dirty = true;
    kick();
  }
  return ctrl;
}

/**
 * Mounts the scene on `canvas`. Returns `null` when WebGL2 is unavailable or
 * setup fails, so the caller keeps the static poster. Only one scene lives at a
 * time: mounting again tears the previous one down first (keeping the context).
 */
export function mountScene(canvas: HTMLCanvasElement, opts: SceneOptions): SceneController | null {
  let controller: SceneController | null = null;
  try {
    controller = mountInternal(canvas, opts);
  } catch (error) {
    console.error(error);
    return null;
  }
  current = controller;
  return controller;
}
