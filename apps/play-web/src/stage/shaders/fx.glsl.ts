import { NOISE } from './common.glsl';

// The formation: a wheel standing behind the cultivator, and its mark on the rock (uFlat). It is there only while
// cultivating or breaking through (uRing).
export const WHEEL_FS = /* glsl */ `
uniform float uTime; uniform float uAura; uniform float uCharge; uniform float uGold; uniform float uPillar; uniform float uFlat;
uniform float uRing;
varying vec2 vUv;
${NOISE}
float ln(float d, float w){ return 1.0 - smoothstep(0.0, w, abs(d)); }
void main(){
  vec2 p = (vUv - 0.5) * 2.0; float r = length(p); if(r > 1.0) discard;
  float a = atan(p.y, p.x); float spin = uTime * 0.06;
  float I = ln(r - 0.900, 0.014) + ln(r - 0.855, 0.007) * 0.6 + ln(r - 0.560, 0.009) * 0.7;
  float ta = (a + spin) / 6.2831853 * 72.0;
  float tick = 1.0 - smoothstep(0.10, 0.18, abs(fract(ta) - 0.5));
  I += tick * smoothstep(0.795, 0.805, r) * (1.0 - smoothstep(0.835, 0.845, r)) * 0.45;
  float aa = a - spin * 1.5; float seg = 0.7853982; float id = floor(aa / seg); float local = fract(aa / seg) - 0.5;
  float arc = 1.0 - smoothstep(0.26, 0.29, abs(local));
  for(int k = 0; k < 3; k++){
    float rr = 0.630 + float(k) * 0.050;
    float whole = step(0.5, hash(vec2(id, float(k)) + 11.0));
    float brk = mix(smoothstep(0.045, 0.075, abs(local)), 1.0, whole);
    I += ln(r - rr, 0.016) * arc * brk * 0.8; }
  float glow = exp(-r * r * 2.2) * 0.065 + exp(-pow((r - 0.9) * 9.0, 2.0)) * 0.04;
  vec3 col = mix(vec3(0.30, 0.95, 0.82), vec3(1.0, 0.82, 0.45), uGold);
  float power = 0.30 + uAura * 0.9 + uCharge * 1.8 + uPillar * 1.2;
  gl_FragColor = vec4(col * (I * power * mix(1.0, 0.7, uFlat) + glow * (0.6 + uAura + uCharge * 2.0)) * uRing, 1.0); }
`;

export const GLOW_FS = /* glsl */ `
uniform float uAura; uniform float uCharge; uniform float uGold; uniform float uPillar; uniform float uRing; varying vec2 vUv;
void main(){ vec2 p = (vUv - 0.5) * 2.0; float r2 = dot(p, p); float g = exp(-r2 * 6.0) * 0.5 + exp(-r2 * 34.0);
  vec3 col = mix(vec3(0.30, 0.95, 0.82), vec3(1.0, 0.82, 0.48), uGold);
  gl_FragColor = vec4(col * g * (uAura * 0.04 * uRing + uCharge * 0.26 + uPillar * 0.8), 1.0); }
`;

// Spirit motes. Each kind has its own motion body; it sets p (world position), size and vA (brightness).
export function motesVs(body: string): string {
  return /* glsl */ `
attribute vec4 aSeed; uniform float uTime; uniform float uAura; uniform float uCharge; uniform float uBurst;
uniform float uBurstGain; uniform vec3 uCenter; uniform float uPx; uniform float uRing; varying float vA;
void main(){ vec3 p; float size;
${body}
  vec4 mv = viewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
  gl_PointSize = size * uPx * (18.0 / max(-mv.z, 0.5)); }
`;
}

export const MOTES_FS = /* glsl */ `
uniform float uGold; varying float vA;
void main(){ float d = length(gl_PointCoord - 0.5); float a = 1.0 - smoothstep(0.0, 0.5, d); a *= a;
  vec3 col = mix(vec3(0.30, 0.92, 0.80), vec3(1.0, 0.82, 0.48), uGold); gl_FragColor = vec4(col * a * vA, 1.0); }
`;

// drifting around the protagonist: faint at rest, brighter with the formation
export const MOTES_DRIFT = /* glsl */ `
  float t = uTime * (0.10 + aSeed.y * 0.20);
  float ang = aSeed.x * 6.2831 + t * (0.5 + aSeed.z);
  float rad = 0.35 + aSeed.z * aSeed.z * 2.8;
  float life = fract(aSeed.w + t * 0.22);
  p = uCenter + vec3(cos(ang) * rad, life * 4.6 - 0.2, sin(ang) * rad);
  size = (1.2 + aSeed.y * 2.4) * (1.0 + uCharge * 0.6);
  vA = sin(life * 3.14159) * (0.18 + uAura * 0.45 + uCharge * 0.5) * (0.45 + 0.55 * uRing);
`;

// streaming in from all round while cultivating: five arms spiralling into the cultivator
export const MOTES_STREAM = /* glsl */ `
  float arm = floor(aSeed.z * 5.0) / 5.0 * 6.2831853;
  float prog = fract(aSeed.x + uTime * (0.16 + aSeed.y * 0.05));
  float e = pow(prog, 0.75);
  float rad = mix(13.0, 0.25, e);
  float ang = arm + e * 5.5 + (aSeed.w - 0.5) * 0.35 * (1.0 - e);
  p = uCenter + vec3(cos(ang) * rad, mix(3.2 + (aSeed.w - 0.5) * 2.0, 0.8, e), sin(ang) * rad);
  size = (1.6 + aSeed.y * 2.6) * (0.5 + e);
  vA = uCharge * smoothstep(0.0, 0.15, prog) * (1.0 - smoothstep(0.92, 1.0, prog)) * (0.35 + 0.65 * e);
`;

// bursting outwards on a breakthrough (or scattering, dimmer, when it fails)
export const MOTES_BURST = /* glsl */ `
  vec3 dir = normalize(vec3(aSeed.x * 2.0 - 1.0, aSeed.y * 1.4 - 0.3, aSeed.z * 2.0 - 1.0));
  float b = clamp(uBurst, 0.0, 1.0);
  p = uCenter + vec3(0.0, 0.7, 0.0) + dir * (6.0 + aSeed.w * 16.0) * (1.0 - pow(1.0 - b, 3.0));
  size = 3.0 + aSeed.w * 4.0;
  vA = (1.0 - b) * (1.0 - b) * 1.6 * uBurstGain;
`;

// the pillar of light
export const BEAM_FS = /* glsl */ `
uniform float uTime; uniform float uPillar; uniform float uGold; varying vec2 vUv;
${NOISE}
void main(){
  float x = (vUv.x - 0.5) * 2.0;
  float core = exp(-x * x * 1400.0);
  float mid = exp(-x * x * 90.0);
  float wide = exp(-x * x * 7.0);
  float streak = 0.55 + 0.45 * noise(vec2(x * 60.0, vUv.y * 30.0 - uTime * 4.0));
  float rise = smoothstep(0.0, 0.02, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y));
  vec3 col = mix(vec3(0.55, 0.95, 0.88), vec3(1.0, 0.84, 0.52), uGold);
  float I = core * 3.2 + mid * streak * 0.9 + wide * 0.10;
  gl_FragColor = vec4((col * I + vec3(1.0) * core * 1.5) * rise * uPillar, 1.0); }
`;

// the rings the pillar sends across the clouds
export const RING_VS = /* glsl */ `void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
export const RING_FS = /* glsl */ `
uniform float uA; uniform float uGold;
void main(){ gl_FragColor = vec4(mix(vec3(0.5, 0.92, 0.86), vec3(1.0, 0.86, 0.56), uGold) * uA, 1.0); }
`;

// sword-light crossing the sky
export const STREAK_FS = /* glsl */ `
uniform float uI; varying vec2 vUv;
void main(){ float core = 1.0 - smoothstep(0.0, 0.5, abs(vUv.y - 0.5)); float head = pow(vUv.x, 3.0);
  gl_FragColor = vec4(vec3(0.75, 0.95, 1.0) * core * core * head * uI, 1.0); }
`;

// the sword hovering at the cultivator's shoulder, point down; it comes and goes with the formation (uRing)
export const BLADE_VS = /* glsl */ `
varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
export const BLADE_FS = /* glsl */ `
uniform float uGold; uniform float uAura; uniform float uCharge; uniform float uRing; varying vec3 vP;
void main(){ vec3 c = mix(vec3(0.55, 1.0, 0.92), vec3(1.0, 0.90, 0.62), uGold); float edge = smoothstep(0.2, 1.0, abs(vP.x) / 0.021);
  gl_FragColor = vec4(c * (0.85 + edge * 0.5 + uAura * 0.5 + uCharge * 1.3) * uRing, uRing); }
`;
export const BLADE_GLOW_FS = /* glsl */ `
uniform float uGold; uniform float uAura; uniform float uCharge; uniform float uRing; varying vec2 vUv;
void main(){ vec2 p = (vUv - 0.5) * 2.0; float g = exp(-p.x * p.x * 26.0) * exp(-p.y * p.y * 3.2);
  vec3 c = mix(vec3(0.30, 0.95, 0.82), vec3(1.0, 0.82, 0.48), uGold);
  gl_FragColor = vec4(c * g * (0.22 + uAura * 0.3 + uCharge * 0.6) * uRing, 1.0); }
`;
