// GLSL shared by the stage's materials. Ported from the stage prototype's stage.js (deleted in plan item 75); the
// prototype's dawn constants are uniforms now, so day and dusk are the same shaders with other values (see hours.ts).

export const NOISE = /* glsl */ `
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for(int i = 0; i < 5; i++){ s += a * noise(p); p = p * 2.02 + vec2(17.0, 31.0); a *= 0.5; } return s; }
`;

// The sky's colour without the painting. It is also the colour distance fades to, so the horizon has no seam.
// uDay blends the night pole (constants) with the lit pole (this hour's uniforms).
export const ATMO = /* glsl */ `
uniform float uDay; uniform float uFog; uniform vec3 uMoonDir; uniform vec3 uSunDir;
uniform vec3 uAtmoZen; uniform vec3 uAtmoHor; uniform vec3 uAtmoSun; uniform vec3 uSunGlow;
vec3 atmo(vec3 d, float sharp){
  float h = 1.0 - max(d.y, 0.0);
  vec3 night = mix(vec3(0.008, 0.016, 0.044), vec3(0.045, 0.085, 0.150), pow(h, 7.0));
  float saz = max(dot(normalize(d.xz + vec2(0.0001)), normalize(uSunDir.xz)), 0.0);
  vec3 litHor = mix(uAtmoHor, uAtmoSun, pow(saz, 4.0));
  vec3 lit = mix(uAtmoZen, litHor, pow(h, 12.0));
  vec3 col = mix(night, lit, uDay);
  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.42, 0.56, 0.90) * (pow(md, 40.0) * 0.26 + pow(md, 6.0) * 0.035) * (1.0 - uDay);
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunGlow * (pow(sd, 10.0) * 0.24 + pow(sd, 120.0) * 0.9 * sharp) * uDay;
  return col; }
vec3 haze(vec3 view){ return atmo(normalize(vec3(view.x, 0.0001, view.z)), 0.3); }
float fogAmt(float dist){ return 1.0 - exp(-dist * uFog); }
`;

// The formation lights its surroundings only while it is there (uRing); the gathering qi and the pillar always do.
export const LIGHT = /* glsl */ `
uniform vec3 uLightDir; uniform vec3 uMistCol; uniform float uAura; uniform float uCharge; uniform float uGold;
uniform float uPillar; uniform float uFlash; uniform vec3 uCenter; uniform vec3 uKeyNight; uniform vec3 uKeyLit;
uniform float uRing;
vec3 keyCol(){ return mix(uKeyNight, uKeyLit, uDay); }
vec3 auraCol(){ return mix(vec3(0.30, 0.95, 0.82), vec3(1.0, 0.80, 0.45), uGold); }
float auraPower(){ return uAura * 0.22 * uRing + uCharge * 1.1 + uPillar * 2.6; }
vec3 auraLight(vec3 w, vec3 n){
  vec3 to = uCenter + vec3(0.0, 0.5, 0.0) - w; float d2 = dot(to, to);
  float wrap = max(dot(n, normalize(to)) * 0.6 + 0.4, 0.0);
  return auraCol() * wrap * auraPower() / (1.0 + d2 * 0.55); }
`;

export const UV_VS = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

// World-space normal through the normal matrix, so flattened and stretched meshes shade correctly.
export const SOLID_VS = /* glsl */ `
varying vec3 vW; varying vec3 vN; varying vec3 vL;
void main(){ vL = position; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
  vN = normalize((vec4(normalMatrix * normal, 0.0) * viewMatrix).xyz);
  gl_Position = projectionMatrix * viewMatrix * w; }
`;
