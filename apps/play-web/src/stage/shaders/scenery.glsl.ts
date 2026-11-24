import { ATMO, NOISE } from './common.glsl';

// A scene's own lights (SceneFile.effects): shafts through windows, ground fire, glowing runes. All additive.

// A shaft: a ribbon from the window (q.x 0) to where the light lands (q.x 1), turned to face the camera about its
// own axis and widening as it falls.
export const SHAFT_VS = /* glsl */ `
attribute vec2 aQ; uniform vec3 uFrom; uniform vec3 uTo; uniform float uW0; uniform float uW1;
varying vec2 vQ;
void main(){
  vec3 axis = uTo - uFrom;
  vec3 at = uFrom + axis * aQ.x;
  vec3 side = normalize(cross(axis, cameraPosition - at));
  at += side * aQ.y * mix(uW0, uW1, aQ.x) * 0.5;
  vQ = aQ;
  gl_Position = projectionMatrix * viewMatrix * vec4(at, 1.0); }
`;

// soft across, fading in from the window and out where it lands, with slow streaks and dust specks drifting down it
export const SHAFT_FS = /* glsl */ `
uniform float uTime; uniform float uK; uniform vec3 uCol; uniform float uLen; varying vec2 vQ;
${NOISE}
void main(){
  float across = exp(-vQ.y * vQ.y * 2.6) - 0.074;
  float along = smoothstep(0.0, 0.14, vQ.x) * (1.0 - smoothstep(0.62, 1.0, vQ.x)) * mix(1.0, 0.6, vQ.x);
  float streak = 0.55 + 0.45 * noise(vec2(vQ.y * 4.0 - vQ.x * 2.0, uTime * 0.06));
  vec2 g = vec2(vQ.y * 7.0, vQ.x * uLen * 2.2 + uTime * 0.28);
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5 - (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.6;
  float h = hash(cell);
  float dust = step(0.9, h) * (1.0 - smoothstep(0.04, 0.16, length(f))) * (0.5 + 0.5 * sin(uTime * 1.3 + h * 40.0));
  float I = max(across, 0.0) * along * (streak * 0.2 + dust * 0.7);
  gl_FragColor = vec4(uCol * I * uK, 1.0); }
`;

export const PLANE_VS = /* glsl */ `
varying vec3 vW; varying vec2 vUv;
void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
`;

// Ground fire: rifts of molten light and glowing pools on a plane just over the floor, drawn before the floor's
// drifting mist so the mist goes over them (and the floor itself glows red over the fire, see FLOOR_FS). Seen from
// the bridge the plane is nearly edge-on, so the pattern is drawn stretched about two and a half times along the
// view (z): its rifts then run into the distance, broken and branching, instead of lying in level bands like a
// sunset's clouds. The rifts follow where a warped slow noise crosses its middle, the pools where a finer one is
// high; the whole bed glows a dull red between them, and everything flickers.
export const FIRE_FS = /* glsl */ `
uniform float uTime; uniform vec3 uAt; uniform float uR; uniform float uK; varying vec3 vW;
${NOISE}
${ATMO}
void main(){
  vec2 d = (vW.xz - uAt.xz) / uR;
  float fall = 1.0 - smoothstep(0.3, 1.0, length(d));
  if(fall <= 0.0) discard;
  vec2 p = vec2(vW.x * 0.11, vW.z * 0.042);
  vec2 warp = vec2(fbm(p * 0.7 + vec2(3.1, uTime * 0.006)), fbm(p * 0.7 + vec2(7.7, -uTime * 0.005)));
  p += (warp - 0.5) * 1.4;
  float n = fbm(p + vec2(uTime * 0.008, -uTime * 0.013));
  float edge = 1.0 - abs(n * 2.0 - 1.0);
  float rift = pow(edge, 9.0);
  float m = fbm(p * 2.4 + vec2(-uTime * 0.035, uTime * 0.018) + n * 1.6);
  float pool = smoothstep(0.6, 0.8, m);
  float heat = rift * (0.45 + 0.55 * smoothstep(0.3, 0.65, m)) + pool * 0.7;
  float flick = 0.8 + 0.2 * sin(uTime * 5.3 + m * 17.0) * sin(uTime * 2.1 + n * 9.0);
  vec3 hot = mix(vec3(0.95, 0.2, 0.03), vec3(1.4, 0.68, 0.2), smoothstep(0.6, 1.1, heat));
  vec3 col = hot * heat * 1.5 * flick + vec3(0.5, 0.08, 0.015) * pow(edge, 3.0) * 0.22 + vec3(0.12, 0.016, 0.006) * (0.5 + 0.5 * m);
  vec3 view = vW - cameraPosition;
  gl_FragColor = vec4(col * fall * uK * (1.0 - fogAmt(length(view)) * 0.6), 1.0); }
`;

// Embers rising from the fire through the abyss, from the fire's far side up to the near cliff: a soft orange glow
// with a hot core, a few pixels across even far off and larger near, swaying as they rise, flickering, burning out.
export const EMBER_VS = /* glsl */ `
attribute vec4 aSeed; uniform float uTime; uniform vec3 uAt; uniform float uR; uniform float uK; uniform float uPx;
varying float vA; varying float vHot;
void main(){
  float speed = 0.045 + aSeed.y * 0.05;
  float life = fract(aSeed.w + uTime * speed);
  vec2 at = vec2(aSeed.x - 0.5, aSeed.z) * vec2(uR * 0.9, uR * 0.95) + vec2(uAt.x, uAt.z - uR * 0.4);
  float rise = life * (14.0 + aSeed.y * 6.0) + life * life * 3.0;
  float sway = sin(uTime * (0.5 + aSeed.y * 0.4) + aSeed.x * 40.0) * (0.5 + life * 1.2);
  vec3 p = vec3(at.x + sway + life * 1.5, uAt.y + rise, at.y + cos(uTime * 0.4 + aSeed.w * 30.0) * 0.6);
  vec4 mv = viewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
  float depth = max(-mv.z, 0.5);
  gl_PointSize = (4.0 + aSeed.y * 6.0) * uPx * clamp(30.0 / depth, 0.6, 3.0);
  vHot = aSeed.y;
  vA = sin(life * 3.14159) * (1.0 - life * 0.4) * uK * (0.6 + 0.4 * sin(uTime * (5.0 + aSeed.x * 4.0) + aSeed.x * 50.0)); }
`;

export const EMBER_FS = /* glsl */ `
varying float vA; varying float vHot;
void main(){ float d = length(gl_PointCoord - 0.5);
  float halo = 1.0 - smoothstep(0.06, 0.5, d); halo *= halo;
  float core = 1.0 - smoothstep(0.0, 0.16, d);
  vec3 c = vec3(1.0, 0.36, 0.07) * halo * 1.3 + vec3(1.3, 0.85, 0.5) * core * (0.5 + 0.9 * vHot);
  gl_FragColor = vec4(c * vA, 1.0); }
`;

// Runes: a ring of glyphs in the plane of the painting (the quad is already squashed to the painted ellipse), two
// circles either side, each glyph a few strokes between points of a 3 x 3 grid, picked by its number, pulsing on its
// own beat; the whole ring turns very slowly, and the stone under it takes a soft glow. A ring lying on the ground is
// seen nearly edge-on (uSquash, its height over its width), so there every width grows: by about 1.6 at the ends of
// the long axis and up to about three towards the near and far sides, where the ellipse thins most.
export const RUNES_FS = /* glsl */ `
uniform float uTime; uniform float uK; uniform vec3 uCol; uniform float uCount; uniform float uSquash; varying vec2 vUv;
${NOISE}
float seg(vec2 p, vec2 a, vec2 b, float w){
  vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  float d = length(pa - ba * h); float aa = fwidth(d) * 1.2 + 1e-4;
  return 1.0 - smoothstep(w - aa, w + aa, d); }
vec2 node(float h){ return vec2(floor(h * 3.0), floor(fract(h * 7.31) * 3.0)) * 0.36 + 0.14; }
float glyph(vec2 q, float id, float w){
  float g = 0.0;
  for(int k = 0; k < 4; k++){
    vec2 a = node(hash(vec2(id, float(k) * 1.7 + 0.3)));
    vec2 b = node(hash(vec2(id + 9.0, float(k) * 2.3 + 0.9)));
    if(length(a - b) > 0.01) g = max(g, seg(q, a, b, w));
  }
  return g; }
void main(){
  vec2 p = (vUv - 0.5) * 2.3;
  float r = length(p);
  float a0 = atan(p.y, p.x);
  float lying = 1.0 - smoothstep(0.3, 1.0, uSquash);
  // how much of a radial width is left on screen at this angle: 1 along the long axis, uSquash across it
  float left = sqrt(cos(a0) * cos(a0) + uSquash * uSquash * sin(a0) * sin(a0));
  float k = (1.0 + 0.6 * lying) / mix(1.0, left, 0.5 * lying);
  float ring = 1.0 - smoothstep(0.0, 0.011 * k + fwidth(r), abs(r - 0.99));
  ring += (1.0 - smoothstep(0.0, 0.009 * k + fwidth(r), abs(r - 0.69))) * 0.65;
  float a = a0 + uTime * 0.025;
  float u = a / 6.2831853 * uCount;
  float id = floor(u);
  float band = 0.22 * min(k, 1.35);
  vec2 q = vec2(fract(u), (r - (0.84 - band * 0.5)) / band);
  float pulse = 0.5 + 0.5 * sin(uTime * 1.1 + id * 2.4);
  float g = (q.y > 0.0 && q.y < 1.0) ? glyph(q, mod(id, uCount), 0.055 * min(k, 1.5)) * (0.45 + 0.75 * pulse) : 0.0;
  // the glow on the stone stays inside the quad, so its edge never shows
  float glow = (exp(-pow((r - 0.84) * 5.0 / min(k, 1.3), 2.0)) * (0.10 + 0.03 * lying) + exp(-r * r * 3.0) * 0.03)
    * (1.0 - smoothstep(1.0, 1.12, r));
  gl_FragColor = vec4(uCol * (ring * (0.8 - 0.15 * lying) + g * (1.4 - 0.3 * lying) + glow) * uK, 1.0); }
`;
