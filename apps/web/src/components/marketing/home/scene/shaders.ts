/**
 * GLSL for "The Line", the home page scene, copied verbatim from the approved
 * prototype. Each block is a vertex or fragment shader pair for one object in
 * `scene.ts` (the strands, the glass sheet, the head bead, the word tokens, the
 * week lattice, the calendar, the dashboard plate rim, the rings, the dust).
 * The shared chunks (`GLSL_COMMON`, `GLSL_PLATE_OCC`, `RIBBON_GLSL`) are spliced
 * into the others with template interpolation.
 */

export const GLSL_COPY = /* glsl */ `
uniform vec3 uCopy[6];   // phones: bands (y0, y1 in uv from the top, strength) where readable copy sits right now
float copyMask() {
  float y = 1.0 - gl_FragCoord.y / uRes.y;
  float m = 1.0;
  for (int i = 0; i < 6; i++) {
    vec3 b = uCopy[i];
    m *= 1.0 - b.z * smoothstep(b.x - 0.012, b.x + 0.006, y) * (1.0 - smoothstep(b.y - 0.006, b.y + 0.012, y));
  }
  return m;
}
`;
export const GLSL_COMMON = /* glsl */ `
uniform vec2 uRes; uniform float uDpr; uniform float uDark; uniform vec2 uFog;
uniform float uMaskMix;  // how much the calendar and plate obey the text mask
uniform vec4 uMaskA;   // leftW, leftStrength, fullStrength, -
uniform vec3 uMaskB1;  // y0, y1, strength
uniform vec3 uMaskB2;
uniform vec4 uMaskR; uniform float uMaskRS;   // one soft rectangle (uv, y down) that keeps the headline clear
${GLSL_COPY}
float rectf(vec2 uv, vec4 r) { return smoothstep(r.x - 0.04, r.x, uv.x) * (1.0 - smoothstep(r.z - 0.10, r.z, uv.x)) * smoothstep(r.y - 0.06, r.y, uv.y) * (1.0 - smoothstep(r.w, r.w + 0.08, uv.y)); }
float bandf(float y, float a, float b) { return smoothstep(a - 0.06, a, y) * (1.0 - smoothstep(b, b + 0.06, y)); }
float safeMask() {
  vec2 uv = vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y);
  float l = uMaskA.y * (1.0 - smoothstep(uMaskA.x - 0.10, uMaskA.x, uv.x));
  float b1 = uMaskB1.z * bandf(uv.y, uMaskB1.x, uMaskB1.y);
  float b2 = uMaskB2.z * bandf(uv.y, uMaskB2.x, uMaskB2.y);
  return (1.0 - l) * (1.0 - b1) * (1.0 - b2) * (1.0 - uMaskA.z) * (1.0 - uMaskRS * rectf(uv, uMaskR)) * copyMask();
}
vec4 hairOut(vec3 col, float a) {
  a = max(a, 0.0);
  if (uDark > 0.5) return vec4(1.0 - exp(-col * a), 1.0);
  a = min(a * 2.4, 1.0);
  return vec4(mix(vec3(1.0), col, a), 1.0);   // multiply on ivory, so ink never turns into a grey haze
}
`;
export const GLSL_PLATE_OCC = /* glsl */ `
uniform vec3 uPlC; uniform vec3 uPlF; uniform vec3 uPlN; uniform vec3 uPlB; uniform vec2 uPlHalf; uniform float uPlVis;
float plateOcc(vec3 wp) {
  if (uPlVis < 0.001) return 0.0;
  float dz = dot(wp - uPlC, uPlF);
  if (dz > 0.0) return 0.0;
  float dc = dot(cameraPosition - uPlC, uPlF);
  if (dc <= 0.0) return 0.0;
  vec3 rd = wp - cameraPosition;
  float t = -dc / dot(rd, uPlF);
  vec3 hit = cameraPosition + rd * t - uPlC;
  vec2 q = vec2(dot(hit, uPlN), dot(hit, uPlB));
  vec2 e = uPlHalf - abs(q);
  return uPlVis * smoothstep(0.0, 0.03, min(e.x, e.y));
}
`;

export const RIBBON_GLSL = /* glsl */ `
uniform float uFan, uFar, uRip, uHead, uTaper, uGap, uSwell;
uniform vec2 uRes; uniform float uDpr;
vec3 ribbonAt(vec3 P, vec3 N, vec3 B, vec2 v, float u, float ava, float fk, float lane) {
  float side = mix(-1.0, 1.0, ava);
  float e = mix(v.y, v.x, ava);
  float dv = -(viewMatrix * vec4(P, 1.0)).z;
  float boost = 1.0 + uFar * clamp((dv - 6.0) / 8.0, 0.0, 2.2);
  float nearK = 0.12 + 0.88 * smoothstep(2.0, 8.0, dv);
  float tp = mix(1.0, uTaper, smoothstep(0.0, 0.06, max(u - uHead, 0.0))) * (u < uHead ? smoothstep(0.0, 0.05, uHead - u) : smoothstep(0.0, 0.02, u - uHead));   // a waist at the head, so the light never folds into a quill    // the part not yet spoken tapers to a calm, low frequency envelope
  float W = 0.02 + e * 1.05 * boost * nearK * tp * uSwell;                  // half width of the swell, one smooth envelope per speaker
  float spread = W * (0.10 + 0.90 * fk) * (1.0 - 0.85 * uFan);
  float ripple = sin(u * 26.0 + fk * 2.4 + (1.0 - ava) * 1.7) * (0.004 + 0.08 * e * mix(1.0, boost, 0.5) * fk * tp * uSwell * uSwell) * uRip * (1.0 - 0.7 * uFan);
  vec3 dirA = N * 0.53 + B * 0.848; vec3 dirB = B * 0.53 - N * 0.848;
  vec3 pos = P + side * dirA * spread + dirB * ripple;
  pos += B * (lane - 3.5) * uFan * uGap;
  return pos;
}
`;
export const STRAND_VS = /* glsl */ `
uniform float uWidthPx, uFocus, uLaneIdx;
attribute vec3 aN; attribute vec3 aB; attribute vec3 aP1; attribute vec3 aN1; attribute vec3 aB1;
attribute vec2 aV; attribute vec2 aV1; attribute vec2 aU; attribute float aSide;
attribute float aK; attribute float aLead;
varying float vSide; varying float vU; varying float vDist; varying float vLaneW; varying float vCaller; varying float vE;
varying vec3 vWorld;
${RIBBON_GLSL}
void main() {
  float ava = step(aK, 0.5);
  bool isLead = aLead > 0.5;
  float fk = ava > 0.5 ? aK * 2.0 : (1.0 - aK) * 2.0;
  float lane = floor(aK * 7.999);
  vec3 w0 = ribbonAt(position, aN, aB, aV, aU.x, ava, fk, lane);
  vec3 w1 = ribbonAt(aP1, aN1, aB1, aV1, aU.y, ava, fk, lane);
  vec4 c0 = projectionMatrix * viewMatrix * vec4(w0, 1.0);
  vec4 c1 = projectionMatrix * viewMatrix * vec4(w1, 1.0);
  vec2 d = normalize((c1.xy / max(c1.w, 0.02) - c0.xy / max(c0.w, 0.02)) * uRes + 1e-5);
  float dist = c0.w;
  float w = uWidthPx * (isLead ? 1.5 : 1.0) + abs(dist - uFocus) * 0.05 * uDpr;
  gl_Position = c0;
  gl_Position.xy += vec2(-d.y, d.x) * aSide * w / uRes * c0.w;
  vSide = aSide; vU = aU.x; vDist = dist; vCaller = 1.0 - ava;
  vE = mix(aV.y, aV.x, ava);
  vLaneW = 1.0 - smoothstep(0.0, 1.0, abs(lane - uLaneIdx));
  vWorld = w0;
}`;
export const STRAND_FS = /* glsl */ `
uniform float uHead, uGhost, uReveal, uAlpha, uFocus, uFan, uGain, uAF;
uniform vec3 uFilament, uInk2;
varying float vSide; varying float vU; varying float vDist; varying float vLaneW; varying float vCaller; varying float vE;
varying vec3 vWorld;
${GLSL_COMMON}
${GLSL_PLATE_OCC}
void main() {
  float prof = exp(-vSide * vSide * 3.0);
  float behind = exp(-max(uHead - vU, 0.0) * 18.0);
  float lit = mix(0.55, 1.0, behind);
  float lived = mix(uGhost, lit, 1.0 - smoothstep(uHead - 0.004, uHead + 0.004, vU)) * exp(-max(vU - uHead, 0.0) * uAF);
  float draw = 1.0 - smoothstep(uReveal - 0.02, uReveal, vU);
  float fog = 1.0 - smoothstep(uFog.x, uFog.y, vDist);
  float lane = mix(1.0, mix(0.5, 4.0, vLaneW), uFan);          // eight lanes: the chosen one at about 60 percent, the rest at about 12
  float near = smoothstep(1.2, 3.6, vDist);
  float a = prof * lived * draw * fog * lane * near * safeMask() * uAlpha * uGain * (0.85 + 0.4 * vE)
          / (1.0 + abs(vDist - uFocus) * 0.05);
  a *= 1.0 - plateOcc(vWorld);
  a *= mix(3.6, 1.0, uDark);                                    // graphite line art on ivory: firm ridge lines
  vec3 col = mix(uFilament, uInk2, vCaller * 0.3);
  gl_FragColor = hairOut(col, a);
  #include <colorspace_fragment>
}`;
export const SHEET_VS = /* glsl */ `
attribute vec3 aN; attribute vec3 aB; attribute vec2 aV; attribute vec2 aU; attribute float aSide; attribute float aK;
varying float vR; varying float vU; varying float vDist; varying float vE; varying vec3 vWorld;
${RIBBON_GLSL}
void main() {
  float ava = step(aK, 0.5);
  float r = aSide * 0.5 + 0.5;
  vec3 w0 = ribbonAt(position, aN, aB, aV, aU.x, ava, r, 3.5);
  vec4 c0 = projectionMatrix * viewMatrix * vec4(w0, 1.0);
  gl_Position = c0;
  vR = r; vU = aU.x; vDist = c0.w; vE = mix(aV.y, aV.x, ava); vWorld = w0;
}`;
export const SHEET_FS = /* glsl */ `
uniform float uHead, uGhost, uReveal, uAlpha, uFan, uSheetGain, uAF;
uniform vec3 uFilament;
varying float vR; varying float vU; varying float vDist; varying float vE; varying vec3 vWorld;
${GLSL_COMMON}
${GLSL_PLATE_OCC}
void main() {
  float body = 0.30 + 0.70 * pow(vR, 1.5);                     // glass: quiet in the middle, a little denser toward the rim
  float wide = 1.0 - exp(-vE * 10.0);                          // nothing at all while the line is silent
  float behind = exp(-max(uHead - vU, 0.0) * 18.0);
  float lit = mix(0.55, 1.0, behind);
  float lived = mix(uGhost, lit, 1.0 - smoothstep(uHead - 0.004, uHead + 0.004, vU)) * exp(-max(vU - uHead, 0.0) * uAF);
  float draw = 1.0 - smoothstep(uReveal - 0.02, uReveal, vU);
  float fog = 1.0 - smoothstep(uFog.x, uFog.y, vDist);
  float near = smoothstep(1.2, 3.6, vDist);
  float a = body * wide * lived * draw * fog * near * safeMask() * uAlpha * uSheetGain * (1.0 - uFan);
  a *= 1.0 - plateOcc(vWorld);
  a *= mix(1.3, 1.0, uDark);                                    // the sheet stays a quiet 12 percent wash
  gl_FragColor = hairOut(uFilament, a);
  #include <colorspace_fragment>
}`;

export const BEAD_VS = /* glsl */ `
uniform vec2 uRes; uniform vec3 uPos; uniform float uRadiusPx;
varying vec2 vUv;
void main() {
  vUv = position.xy;
  vec4 c = projectionMatrix * viewMatrix * vec4(uPos, 1.0);
  c.xy += position.xy * 2.0 * uRadiusPx / uRes * c.w;
  gl_Position = c;
}`;
export const BEAD_FS = /* glsl */ `
uniform vec3 uCol; uniform float uAlpha, uRadiusPx, uDpr; uniform vec2 uRes;
${GLSL_COPY}
varying vec2 vUv;
void main() {
  float r = length(vUv) * uRadiusPx;                      // device px
  float core = 1.0 - smoothstep(3.0 * uDpr - 0.8, 3.0 * uDpr + 0.8, r);
  float halo = 0.18 * pow(1.0 - smoothstep(0.0, 30.0 * uDpr, r), 2.0);
  float a = max(core, halo) * uAlpha * copyMask();
  gl_FragColor = vec4(uCol, a);
  #include <colorspace_fragment>
}`;

export const TOKEN_VS = /* glsl */ `
attribute vec3 aFrom; attribute vec3 aTo; attribute vec3 aRight; attribute vec3 aUp; attribute vec2 aSize; attribute vec3 aInfo; // aInfo = start s, spk, t start
uniform float uClock;
varying vec2 vLocal; varying vec2 vSize; varying float vLand; varying float vFlash; varying float vSpk; varying float vDist; varying vec3 vWorld;
void main() {
  float tw = aInfo.z;
  float land = smoothstep(tw - 2.0, tw + 0.3, uClock);
  float le = land * land * (3.0 - 2.0 * land);
  vec3 c = mix(aFrom, aTo, le);
  float sc = mix(0.16, 1.0, le);
  vec2 q = position.xy * aSize * sc;
  vec3 wp = c + aRight * q.x + aUp * q.y;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  vLocal = position.xy * aSize * sc; vSize = aSize * sc;
  vLand = land; vFlash = step(tw, uClock) * exp(-max(uClock - tw, 0.0) * 3.0);
  vSpk = aInfo.y; vDist = -mv.z; vWorld = wp;
}`;
export const TOKEN_FS = /* glsl */ `
uniform vec3 uFilament, uInk2; uniform float uTokVis, uTokFade;
varying vec2 vLocal; varying vec2 vSize; varying float vLand; varying float vFlash; varying float vSpk; varying float vDist; varying vec3 vWorld;
${GLSL_COMMON}
${GLSL_PLATE_OCC}
float sdRound(vec2 p, vec2 h, float r) { vec2 q = abs(p) - h + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  vec2 h = vSize * 0.5;
  float r = min(h.y, 0.03);
  float d = sdRound(vLocal, h, r);
  float aa = max(fwidth(d), 1e-5);
  float inside = 1.0 - smoothstep(-aa, aa, d);
  float edge = 1.0 - smoothstep(0.0, aa * 1.4, abs(d + aa * 0.5) - aa * 0.45);
  float k = clamp((-vLocal.x / max(h.x, 1e-4) + vLocal.y / max(h.y, 1e-4)) * 0.5, -1.0, 1.0);
  float rim = 0.5 + 0.5 * k;                                     // thin glass: a lit top-left rim and a 6 percent fill
  float base = mix(0.10, 0.55, vLand) + 0.45 * vFlash;
  float fog = 1.0 - smoothstep(uFog.x, uFog.y, vDist);
  float near = smoothstep(2.6, 6.5, vDist);
  float dotState = 1.0 - vLand;
  vec2 uv = vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y);
  float keepOut = smoothstep(0.46, 0.60, uv.x);                   // never over the caption column or the step rail
  float a = (edge * mix(0.25, 1.0, rim) * 0.7 + inside * (0.02 + 0.02 * rim) + inside * dotState * 0.10) * base * 1.5 * fog * near * safeMask() * keepOut * uTokVis;
  a *= 1.0 - plateOcc(vWorld);
  a *= mix(0.5, 0.72, uDark);
  vec3 col = mix(uFilament, mix(uFilament, uInk2, 0.7), vSpk);
  gl_FragColor = hairOut(col, a);
  #include <colorspace_fragment>
}`;

export const LATTICE_VS = /* glsl */ `
attribute float aH;            // 0..167 bars, 168 = the scan marker
attribute float aClosed;
uniform vec3 uLC; uniform vec3 uLR; uniform vec3 uLD;
uniform float uSweep, uDone, uLatVis, uWidthPx, uPair;
varying float vB; varying float vSide; varying float vDist; varying vec3 vWorld; varying float vScan;
uniform vec2 uRes; uniform float uDpr;
void main() {
  float h = aH;
  bool scan = h > 167.5;
  float cur = clamp(floor(uSweep), 0.0, 167.0);
  if (scan) h = cur;
  float col = mod(h, 24.0), row = floor(h / 24.0);
  float x = (col + 0.5 * uPair - 11.5) * 0.15;
  float dp = (3.0 - row) * 0.34;
  float hl = scan ? 0.19 : 0.13 * mix(1.0, 0.55, aClosed);      // the 50 open hours are tall, the 118 closed hours stay at 55 percent, even when Heyloo answers all of them
  vec3 base = uLC + uLR * x + uLD * dp;
  vec3 A = base - uLD * hl, B = base + uLD * hl;
  vec4 c0 = projectionMatrix * viewMatrix * vec4(A, 1.0);
  vec4 c1 = projectionMatrix * viewMatrix * vec4(B, 1.0);
  bool endB = position.y > 0.0;
  vec4 c = endB ? c1 : c0;
  vec2 d = normalize((c1.xy / c1.w - c0.xy / c0.w) * uRes + 1e-5);
  gl_Position = c;
  gl_Position.xy += vec2(-d.y, d.x) * position.x * uWidthPx * (scan ? 1.0 : mix(1.55, 0.8, aClosed)) / uRes * c.w;
  float lit = clamp(uSweep - h, 0.0, 1.0);
  float closed = scan ? 1.0 : aClosed;
  float b = mix(0.10, mix(1.0, 0.20, closed), lit);            // the working week is the solid block, the other 118 hours stay faint
  b = mix(b, mix(1.0, 0.36, aClosed), uDone);                    // then Heyloo answers all 168, the working week is still the solid block
  float isCur = (lit > 0.0 && lit < 1.0) ? 1.0 : 0.0;
  b = mix(b, 1.0, isCur * (1.0 - uDone));
  if (scan) b = 1.0 * (1.0 - uDone) * step(0.001, uSweep);
  vScan = scan ? 1.0 : 0.0; vB = b * uLatVis; vSide = position.x; vDist = c.w; vWorld = mix(A, B, float(endB));
}`;
export const LATTICE_FS = /* glsl */ `
uniform vec3 uFilament; uniform vec3 uEmber;
varying float vB; varying float vSide; varying float vDist; varying vec3 vWorld; varying float vScan;
${GLSL_COMMON}
void main() {
  float prof = exp(-vSide * vSide * 3.0);
  float fog = 1.0 - smoothstep(uFog.x, uFog.y, vDist);
  float near = smoothstep(0.35, 1.5, vDist);
  float a = prof * vB * fog * near * safeMask() * mix(1.7, 0.75, uDark) * (1.0 + 1.3 * vScan);
  gl_FragColor = hairOut(mix(uFilament, uEmber, vScan), a);
  #include <colorspace_fragment>
}`;

export const LATLAB_VS = /* glsl */ `
uniform vec3 uLC; uniform vec3 uLR; uniform vec3 uLD; uniform vec2 uLHalf;
varying vec2 vUv; varying float vDist;
void main() {
  vec2 q = position.xy * 2.0 * uLHalf;
  vec3 wp = uLC + uLR * q.x + uLD * q.y;
  vec4 c = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  gl_Position = c; vUv = uv; vDist = c.w;
}`;
export const LATLAB_FS = /* glsl */ `
uniform vec3 uFilament; uniform float uLatVis, uDone; uniform sampler2D uLatTex;
varying vec2 vUv; varying float vDist;
${GLSL_COMMON}
void main() {
  vec4 t = texture2D(uLatTex, vUv);
  float fog = 1.0 - smoothstep(uFog.x, uFog.y, vDist);
  float a = (t.r * 0.62 + t.g * 0.025) * uLatVis * fog * smoothstep(0.35, 1.5, vDist) * safeMask() * mix(1.5, 1.0, uDark);
  gl_FragColor = hairOut(uFilament, a);
  #include <colorspace_fragment>
}`;

export const CAL_VS = /* glsl */ `
attribute vec2 aCell; attribute vec2 aFlag;      // col,row ; filled,target
uniform vec3 uCalC; uniform vec3 uCalN; uniform vec3 uCalB;
varying vec2 vLoc; varying vec2 vFlag; varying float vDist; varying vec3 vWorld; varying float vFall;
void main() {
  vec2 pitch = vec2(0.52, 0.18);
  vec2 cc = vec2(aCell.x - 2.0, 5.0 - aCell.y) * pitch;
  vec2 q = position.xy * vec2(0.56, 0.22);
  vec3 wp = uCalC + uCalN * (cc.x + q.x) + uCalB * (cc.y + q.y);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  vLoc = q; vFlag = aFlag; vDist = -mv.z; vWorld = wp;
  vFall = 1.0 - smoothstep(0.30, 1.6, length(cc));
}`;
export const CAL_FS = /* glsl */ `
uniform vec3 uFilament; uniform vec3 uEmber; uniform float uCalVis, uCalCells, uCalTarget, uCalEdge, uEmberMix;
varying vec2 vLoc; varying vec2 vFlag; varying float vDist; varying vec3 vWorld; varying float vFall;
${GLSL_COMMON}
${GLSL_PLATE_OCC}
float sdRound(vec2 p, vec2 h, float r) { vec2 q = abs(p) - h + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  vec2 h = vec2(0.25, 0.08);
  float d = sdRound(vLoc, h, 0.02);
  float aa = max(fwidth(d), 1e-5);
  float line = 1.0 - smoothstep(0.0, aa * 1.5, abs(d) - aa * 0.55);
  float inside = 1.0 - smoothstep(-aa, aa, d);
  float k = clamp((-vLoc.x / h.x + vLoc.y / h.y) * 0.5, -1.0, 1.0);
  float rim = 0.5 + 0.5 * k;                                       // top-left rim light, bottom-right in shade
  float lineR = line * mix(0.25, 1.0, rim);
  float k2 = (abs(vLoc.x) / h.x > abs(vLoc.y) / h.y) ? vLoc.y : vLoc.x;
  float f = fract(k2 * 16.0);
  float dash = smoothstep(0.0, 0.08, f) * (1.0 - smoothstep(0.5, 0.58, f));
  float tgt = vFlag.y;
  float border = mix(lineR * 0.11, lineR * mix(0.42 * dash, 0.8, uCalEdge), tgt);
  border = mix(border, border * 0.85 + lineR * uCalTarget * 0.25, tgt);
  float glow = 0.55 + 0.45 * (0.5 + 0.5 * cos((vLoc.x / 0.25) * 1.6));
  float fill = (vFlag.x * 0.03 + 0.010) * inside * vFall * (0.7 + 0.6 * rim) + tgt * inside * (0.02 + (0.20 + 0.30 * uEmberMix) * uCalTarget) * glow * mix(0.55, 1.0, uDark);
  float a = (border + fill) * uCalVis * mix(uCalCells, 1.0, tgt * uCalTarget) * mix(vFall, 1.0, tgt);
  a *= 1.0 - smoothstep(uFog.x, uFog.y, vDist);
  a *= smoothstep(0.35, 1.5, vDist) * mix(1.0, safeMask(), uMaskMix);
  a *= 1.0 - plateOcc(vWorld);
  vec3 col = mix(uFilament, uEmber, uEmberMix * tgt * inside);
  gl_FragColor = hairOut(col, a * 1.1);
  #include <colorspace_fragment>
}`;
export const CALP_VS = /* glsl */ `
uniform vec3 uCalC; uniform vec3 uCalN; uniform vec3 uCalB; uniform vec3 uCalT; uniform vec2 uCpHalf; uniform vec2 uCpOff;
varying vec2 vLoc; varying float vDist; varying vec3 vWorld; varying vec2 vUv;
void main() {
  vec2 q = position.xy * 2.0 * uCpHalf;
  vec3 wp = uCalC + uCalT * 0.02 + uCalN * (q.x + uCpOff.x) + uCalB * (q.y + uCpOff.y);     // 0.02 units behind the cells
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  vLoc = q; vUv = uv; vDist = -mv.z; vWorld = wp;
}`;
export const CALP_FS = /* glsl */ `
uniform vec3 uFilament; uniform vec3 uEmber; uniform float uCalVis, uCalCells, uCalTarget, uEmberMix; uniform vec2 uCpHalf; uniform sampler2D uLab;
varying vec2 vLoc; varying float vDist; varying vec3 vWorld; varying vec2 vUv;
${GLSL_COMMON}
${GLSL_PLATE_OCC}
float sdRound(vec2 p, vec2 h, float r) { vec2 q = abs(p) - h + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  float d = sdRound(vLoc, uCpHalf, 0.07);
  float aa = max(fwidth(d), 1e-5);
  float line = 1.0 - smoothstep(0.0, aa * 1.5, abs(d) - aa * 0.55);
  float inside = 1.0 - smoothstep(-aa, aa, d);
  float k = clamp((-vLoc.x / uCpHalf.x + vLoc.y / uCpHalf.y) * 0.6, -1.0, 1.0);
  float rim = 0.5 + 0.5 * k;
  vec4 lb = texture2D(uLab, vUv);
  float labA = lb.r * 0.72 * uCalCells;                            // Mon to Fri, 8 AM to 12 PM, in the same mono as the page
  float tagA = lb.g * 0.95 * uCalTarget;                           // the held slot, named
  float a = (line * mix(0.14, 0.70, rim) + inside * (0.014 + 0.022 * rim) + labA * uCalVis * mix(1.4, 1.0, uDark)) * uCalVis;
  float wE = tagA / max(a + tagA, 1e-4) * uCalVis;
  a += tagA * uCalVis;
  a *= 1.0 - smoothstep(uFog.x, uFog.y, vDist);
  a *= smoothstep(0.35, 1.5, vDist) * mix(1.0, safeMask(), uMaskMix);
  a *= 1.0 - plateOcc(vWorld);
  gl_FragColor = hairOut(mix(uFilament, uEmber, clamp(wE * 1.2, 0.0, 1.0)), a);
  #include <colorspace_fragment>
}`;
export const PRIM_VS = /* glsl */ `
uniform vec2 uRimHalf; uniform float uRimM;
varying vec2 vLoc; varying float vDist;
void main() {
  vec2 q = position.xy * 2.0 * (uRimHalf + uRimM);
  vLoc = q;
  vec4 mv = modelViewMatrix * vec4(q, 0.0, 1.0);
  gl_Position = projectionMatrix * mv; vDist = -mv.z;
}`;
export const PRIM_FS = /* glsl */ `
uniform vec3 uFilament; uniform vec2 uRimHalf; uniform float uRimRad, uRimVis, uSweep;
varying vec2 vLoc; varying float vDist;
${GLSL_COMMON}
float sdRound(vec2 p, vec2 h, float r) { vec2 q = abs(p) - h + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  float d = sdRound(vLoc, uRimHalf, uRimRad);
  float aa = max(fwidth(d), 1e-5);
  float line = 1.0 - smoothstep(0.0, aa * 1.5, abs(d - 0.004) - aa * 0.55);
  float nx = vLoc.x / uRimHalf.x, ny = vLoc.y / uRimHalf.y;
  float k = clamp((-nx + ny) * 0.55, -1.0, 1.0);
  float rim = 0.5 + 0.5 * k;                                       // lit from the top left
  float sw = exp(-pow((nx * 0.5 + 0.5 - uSweep) * 3.2, 2.0));       // one slow reflection sweep while the dashboard is read
  float halo = smoothstep(-aa, aa, d) * exp(-max(d, 0.0) / 0.06);   // feathered ring: light in dark theme, a soft shadow in light
  float a = uRimVis * (line * (0.16 + 0.40 * rim + 0.50 * sw) + halo * mix(0.10, 0.05, uDark) * (0.7 + 0.5 * rim));
  gl_FragColor = hairOut(uFilament, a);
  #include <colorspace_fragment>
}`;

export const RING_VS = /* glsl */ `
attribute vec3 aC; attribute vec3 aRN; attribute vec3 aRB; attribute float aLit;
varying vec2 vLoc; varying float vLit; varying float vDist;
void main() {
  vec2 q = position.xy * 2.6;
  vec3 wp = aC + aRN * q.x * 0.34 + aRB * q.y * 0.34;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  vLoc = q; vLit = aLit; vDist = -mv.z;
}`;
export const RING_FS = /* glsl */ `
uniform vec3 uFilament; uniform float uRingVis; uniform vec3 uRingLit;
varying vec2 vLoc; varying float vLit; varying float vDist;
${GLSL_COMMON}
void main() {
  float r = length(vLoc);
  float aa = max(fwidth(r), 1e-5);
  float line = clamp(0.5 * uDpr + 0.5 - abs(r - 1.0) / aa, 0.0, 1.0);   // one hairline, about 1 css px
  float ang = atan(vLoc.y, vLoc.x);
  float rim = 0.62 + 0.38 * cos(ang - 2.35);                              // a slow rim gradient with no hot spot
  float disc = 0.0;                                                        // hoops only, no fill
  float a = (line * rim * (0.30 + 0.70 * vLit) + disc) * uRingVis * (1.0 - smoothstep(uFog.x, uFog.y, vDist)) * smoothstep(2.2, 4.6, vDist) * safeMask();
  gl_FragColor = hairOut(uFilament, a * 0.9);
  #include <colorspace_fragment>
}`;

export const DUST_VS = /* glsl */ `
attribute float aSize; attribute float aAlpha;
varying float vA; varying float vDist;
uniform float uDpr;
void main() {
  vec4 mv = viewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uDpr;
  vA = aAlpha; vDist = -mv.z;
}`;
export const DUST_FS = /* glsl */ `
uniform vec3 uInk2; uniform float uDustVis;
varying float vA; varying float vDist;
${GLSL_COMMON}
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float m = 1.0 - smoothstep(0.30, 0.5, length(p));
  float a = m * vA * uDustVis * (1.0 - smoothstep(uFog.x * 0.8, uFog.y * 0.9, vDist)) * smoothstep(0.35, 1.5, vDist) * safeMask();
  gl_FragColor = hairOut(uInk2, a);
  #include <colorspace_fragment>
}`;
