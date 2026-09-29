/**
 * The static hero poster: the same ribbon the 3D scene draws, as 36 hairline
 * SVG paths. It is what a visitor sees with no WebGL (and before the scene's
 * first frame); `html.gl-on` fades it out. Deterministic, built at render.
 */
const gauss = (x: number, c: number, w: number): number => Math.exp(-(((x - c) / w) ** 2));
const energy = (x: number): number =>
  gauss(x, 430, 120) + 0.6 * gauss(x, 780, 95) + gauss(x, 1090, 130) + 0.8 * gauss(x, 1360, 105);
const base = (x: number): number => 230 + 0.4 * x + 55 * Math.sin(x * 0.0044 - 0.6);
const amp = (x: number): number => 0.35 + 0.65 * (x / 1600);

const STRANDS = 36;
const POINTS = 96;

export interface PosterStrand {
  d: string;
  strokeWidth: string;
  strokeOpacity: string;
}

export function posterStrands(): PosterStrand[] {
  const out: PosterStrand[] = [];
  for (let k = 0; k < STRANDS; k++) {
    const q = k / (STRANDS - 1);
    const side = (q - 0.5) * 2;
    let d = "";
    for (let i = 0; i <= POINTS; i++) {
      const x = -100 + (1800 * i) / POINTS;
      const e = energy(x);
      const y =
        base(x) +
        amp(x) *
          (side * (3 + 95 * e) +
            14 * e * Math.sin(2 * Math.PI * (x / 1600) * (7 + 9 * q) + 6.283 * q));
      d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    out.push({
      d,
      strokeWidth: (0.9 + 0.5 * (1 - Math.abs(side))).toFixed(2),
      strokeOpacity: (0.16 + 0.52 * (1 - Math.abs(side)) ** 1.5).toFixed(2),
    });
  }
  return out;
}

export function Poster() {
  return (
    <div className="poster" aria-hidden="true">
      <svg
        className="poster-svg"
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMaxYMid slice"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <radialGradient id="pg1">
            <stop offset="0" style={{ stopColor: "var(--surface)" }} />
            <stop offset="1" style={{ stopColor: "var(--ground)", stopOpacity: 0 }} />
          </radialGradient>
          <mask id="pm" maskUnits="userSpaceOnUse" x="-100" y="0" width="1800" height="900">
            <linearGradient id="pl" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1600" y2="0">
              <stop offset=".34" stopColor="#000" />
              <stop offset=".68" stopColor="#fff" />
            </linearGradient>
            <rect x="-100" y="0" width="1800" height="900" fill="url(#pl)" />
          </mask>
        </defs>
        <ellipse cx="1120" cy="558" rx="720" ry="520" fill="url(#pg1)" />
        <ellipse cx="400" cy="180" rx="480" ry="270" fill="url(#pg1)" opacity=".5" />
        <g mask="url(#pm)">
          {posterStrands().map((s) => (
            <path
              key={s.d}
              d={s.d}
              style={{ strokeWidth: s.strokeWidth, strokeOpacity: s.strokeOpacity }}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
