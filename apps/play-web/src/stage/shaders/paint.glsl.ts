import { ATMO, LIGHT } from './common.glsl';

// The painted layers. uUv flips a layer by swapping its u range.
export const PAINT_VS = /* glsl */ `
uniform vec4 uUv; varying vec2 vUv; varying vec3 vW;
void main(){ vUv = mix(uUv.xy, uUv.zw, uv); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w; }
`;

// A painting is night-lit as painted. Every other hour is a regrade of the same picture: towards grey by the hour's
// saturation, times the hour's tint (each layer may lean off the hour's values), times the gain. Where a layer stands
// low in the cloud sea it sinks into the colour the clouds have at that distance (over a ground haze, the near
// layers sink into the haze's own colour instead); uSink fades it out by world height so it disappears into the
// clouds without a straight cut, and uEdge fades its two ends. Ground fire lights the low parts from below.
export const PAINT_FS = /* glsl */ `
uniform sampler2D tMap; uniform float uGain; uniform float uHaze; uniform float uMist; uniform vec2 uMistY;
uniform float uMistGain; uniform float uMistHaze; uniform float uAuraK; uniform vec3 uTintN; uniform vec3 uTintRatio;
uniform float uSatOff; uniform vec3 uHourTint; uniform float uHourSat; uniform vec3 uNightTint; uniform float uNightSat;
uniform float uFade; uniform vec2 uSink; uniform float uEdge; uniform vec4 uUv; varying vec2 vUv; varying vec3 vW;
uniform vec3 uGroundCol; uniform float uGroundMix; uniform vec4 uFireLight;
${ATMO}
${LIGHT}
void main(){
  vec4 t = texture2D(tMap, vUv); float eu = (vUv.x - uUv.x) / (uUv.z - uUv.x);
  float a = t.a * uFade * smoothstep(uSink.x, uSink.y, vW.y) * smoothstep(0.0, uEdge, eu) * smoothstep(0.0, uEdge, 1.0 - eu);
  if(a < 0.004) discard;
  vec3 c = pow(t.rgb / max(t.a, 0.004), vec3(2.2));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 night = mix(vec3(l), c, uNightSat) * uNightTint * uTintN;
  vec3 lit = mix(vec3(l), c, clamp(uHourSat + uSatOff, 0.0, 1.0)) * uHourTint * uTintRatio;
  vec3 col = mix(night, lit, uDay) * uGain;
  vec3 view = vW - cameraPosition; float dist = length(view); float fa = fogAmt(dist);
  vec3 mistC = mix(uMistCol * uMistGain, haze(view), max(uMistHaze, fa));
  mistC = mix(mistC, mix(uGroundCol, haze(view), fa), uGroundMix * (1.0 - smoothstep(45.0, 120.0, dist)));
  col = mix(col, mistC, (1.0 - smoothstep(uMistY.x, uMistY.y, vW.y)) * uMist);
  col = mix(col, haze(view), fa * uHaze);
  vec3 to = uCenter + vec3(0.0, 0.5, 0.0) - vW; float d2 = dot(to, to);
  col += (c * 3.0 + 0.015) * auraCol() * auraPower() / (1.0 + d2 * 0.55) * uAuraK;
  col += c * vec3(1.0, 0.32, 0.08) * uFireLight.z * (1.0 - smoothstep(uFireLight.x, uFireLight.x + uFireLight.y, vW.y));
  col += vec3(0.9, 0.86, 0.7) * uFlash * 0.12;
  gl_FragColor = vec4(col * a, a); }
`;

// A painting's depth where it is solid (at least half opaque after its sink and edge fades), and no colour. The
// painted layers write no depth, so without this what is drawn after them (rain, snow, embers) would show through.
export const DEPTH_FS = /* glsl */ `
uniform sampler2D tMap; uniform float uFade; uniform vec2 uSink; uniform float uEdge; uniform vec4 uUv;
varying vec2 vUv; varying vec3 vW;
void main(){
  vec4 t = texture2D(tMap, vUv); float eu = (vUv.x - uUv.x) / (uUv.z - uUv.x);
  float a = t.a * uFade * smoothstep(uSink.x, uSink.y, vW.y) * smoothstep(0.0, uEdge, eu) * smoothstep(0.0, uEdge, 1.0 - eu);
  if(a < 0.5) discard;
  gl_FragColor = vec4(0.0); }
`;

// The sky: a panorama for the night and one for the lit hours, carried with the camera so it sits at infinity; each
// crossfades from the one before when the hour or the weather changes it. A lit hour whose picture is a stand-in
// (another hour's) is regraded by uSkySat and uSkyTint. Near the horizon the painting gives way to the colour the
// cloud sea fades to, so there is no seam.
export const SKY_VS = /* glsl */ `
varying vec2 vUv; varying vec3 vW;
void main(){ vUv = vec2(1.0 - uv.x, uv.y); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w; }
`;

export const SKY_FS = /* glsl */ `
uniform sampler2D tNight; uniform sampler2D tNightPrev; uniform float uNightFade;
uniform sampler2D tLit; uniform sampler2D tLitPrev; uniform float uLitFade;
uniform float uGainN; uniform float uGainLit; uniform vec3 uSkyTint; uniform float uSkySat; uniform float uFlash;
varying vec2 vUv; varying vec3 vW;
${ATMO}
void main(){
  vec3 n = mix(pow(texture2D(tNightPrev, vUv).rgb, vec3(2.2)), pow(texture2D(tNight, vUv).rgb, vec3(2.2)), uNightFade) * uGainN;
  vec3 d = mix(pow(texture2D(tLitPrev, vUv).rgb, vec3(2.2)), pow(texture2D(tLit, vUv).rgb, vec3(2.2)), uLitFade);
  float l = dot(d, vec3(0.2126, 0.7152, 0.0722));
  d = mix(vec3(l), d, uSkySat) * uSkyTint * uGainLit;
  vec3 col = mix(n, d, uDay);
  vec3 dir = normalize(vW - cameraPosition);
  col = mix(atmo(normalize(vec3(dir.x, 0.0001, dir.z)), 0.3), col, smoothstep(-0.012, 0.075, dir.y));
  col += vec3(0.9, 0.86, 0.7) * uFlash * 0.22;
  gl_FragColor = vec4(col, 1.0); }
`;

export const SUN_FS = /* glsl */ `
uniform float uDay; uniform vec3 uSunCol; uniform float uVeiled; varying vec2 vUv;
void main(){ vec2 p = (vUv - 0.5) * 2.0; float r2 = dot(p, p);
  float g = exp(-r2 * 260.0) * 5.0 + exp(-r2 * 22.0) * 0.55 + exp(-r2 * 3.0) * 0.16;
  // behind cloud the disc goes and a dull glow stays
  g = mix(g, exp(-r2 * 3.0) * 0.08, uVeiled);
  gl_FragColor = vec4(uSunCol * g * uDay, 1.0); }
`;
