import { NOISE } from './common.glsl';

// Portraits and the post chain.

// A portrait is a painted cut-out drawn into the scene buffer in screen pixels, so it takes the scene's light and goes
// through the same bloom, grade and grain as everything else. The texture is premultiplied.
export const PORTRAIT_VS = /* glsl */ `
varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

// A portrait lives a little (执行计划第 62 项, uLife): it breathes (above the hips the picture rises and settles by
// 0.28% of its height every 4.6 s) and the edges of its silhouette (hair, sleeves, hems) stir by up to 2.5 screen
// pixels in a slow wind, more at the sides than at the face. Only what lies within 9 px of the outline moves, and
// smoothly, so the outline bends but never breaks.
export const PORTRAIT_FS = /* glsl */ `
uniform sampler2D tMap; uniform vec2 uTexel; uniform vec2 uL; uniform float uA; uniform float uFoot; uniform float uFlip;
uniform float uDay; uniform float uFlash; uniform float uGain; uniform float uRim; uniform float uDim;
uniform vec3 uKeyNight; uniform vec3 uKeyLit; uniform vec3 uAmbLit; uniform vec3 uFootLit;
uniform float uTime; uniform float uLife; uniform float uSeed; uniform vec2 uPxUv;
varying vec2 vUv;
${NOISE}
void main(){
  vec2 uv = vec2(mix(vUv.x, 1.0 - vUv.x, uFlip), vUv.y);
  if(uLife > 0.0){
    float rise = sin(uTime * 1.366 + uSeed) * 0.0028 * smoothstep(0.1, 0.62, uv.y);
    vec2 r = uPxUv * 9.0;
    float inside = (texture2D(tMap, uv + vec2(r.x, 0.0)).a + texture2D(tMap, uv - vec2(r.x, 0.0)).a
      + texture2D(tMap, uv + vec2(0.0, r.y)).a + texture2D(tMap, uv - vec2(0.0, r.y)).a) * 0.25;
    float zone = mix(0.35, 1.0, smoothstep(0.08, 0.3, abs(uv.x - 0.5)));
    vec2 wind = vec2(noise(uv * vec2(5.0, 8.0) + vec2(uTime * 0.42, uTime * 0.27) + uSeed) - 0.5,
                     noise(uv * vec2(6.0, 4.0) - vec2(uTime * 0.23, uTime * 0.38) + uSeed + 3.7) - 0.5);
    uv += (wind * 5.0 * uPxUv * (1.0 - inside) * zone - vec2(0.0, rise)) * uLife;
  }
  vec2 L = vec2(mix(uL.x, -uL.x, uFlip), uL.y);
  vec4 t = texture2D(tMap, uv);
  float a = t.a;
  vec3 c = a > 0.003 ? t.rgb / a : vec3(0.0);
  c = pow(c, vec3(2.2));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 amb = mix(vec3(0.115, 0.150, 0.250), uAmbLit, uDay);
  vec3 key = mix(uKeyNight * 1.5, uKeyLit * 2.4, uDay);
  vec3 base = mix(vec3(l), c, mix(0.62, 0.92, uDay)) * amb * uGain;
  base *= 1.0 + dot(vUv - 0.5, uL) * mix(0.9, 0.7, uDay);
  float e1 = a - texture2D(tMap, uv + L * uTexel * 4.0).a;
  float e2 = a - texture2D(tMap, uv + L * uTexel * 11.0).a;
  float e3 = a - texture2D(tMap, uv + L * uTexel * 24.0).a;
  float rim = clamp(e1, 0.0, 1.0) * 0.55 + clamp(e2, 0.0, 1.0) * 0.35 + clamp(e3, 0.0, 1.0) * 0.15;
  vec3 col = base + key * rim * (0.10 + 0.90 * sqrt(l)) * uGain * uRim;
  col *= (1.0 + uFlash * 0.6) * uDim;
  vec3 mist = mix(vec3(0.050, 0.092, 0.160), uFootLit, uDay);
  float foot = smoothstep(0.0, uFoot, vUv.y);
  col = mix(mist, col, mix(0.30, 1.0, foot));
  a *= smoothstep(0.0, uFoot * 0.5, vUv.y) * uA;
  gl_FragColor = vec4(col * a, a); }
`;

export const POST_VS = /* glsl */ `
varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const BRIGHT_FS = /* glsl */ `
uniform sampler2D tDiffuse; uniform float uCut; varying vec2 vUv;
void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; gl_FragColor = vec4(max(c - uCut, 0.0), 1.0); }
`;

// a separable gaussian (weights 0.227, 0.316, 0.070 at linear-sampled offsets)
export const BLUR_FS = /* glsl */ `
uniform sampler2D tDiffuse; uniform vec2 uDir; varying vec2 vUv;
void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb * 0.227027;
  c += (texture2D(tDiffuse, vUv + uDir * 1.3846154).rgb + texture2D(tDiffuse, vUv - uDir * 1.3846154).rgb) * 0.3162162;
  c += (texture2D(tDiffuse, vUv + uDir * 3.2307692).rgb + texture2D(tDiffuse, vUv - uDir * 3.2307692).rgb) * 0.0702703;
  gl_FragColor = vec4(c, 1.0); }
`;

export const COPY_FS = /* glsl */ `
uniform sampler2D tDiffuse; uniform float uA; varying vec2 vUv;
void main(){ gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb, uA); }
`;

// The last pass: fringe, bloom, exposure, ACES, grade, gamma (by hand: the renderer's output stays linear), the veil,
// vignette (eased off under the veil) and grain; during a crossfade between scenes, the kept picture of the old one
// over it all. The veil takes the soft copy under the reading column and pushes it towards a colour, so the
// text needs no boxed panel.
export const FINAL_FS = /* glsl */ `
uniform sampler2D tScene; uniform sampler2D tBloom1; uniform sampler2D tBloom2; uniform sampler2D tSoft;
uniform float uTime; uniform float uDay; uniform float uFlash; uniform float uExposure; uniform float uVignette;
uniform float uFade; uniform vec2 uRes; uniform vec4 uVeil; uniform float uVeilFeather; uniform float uVeilAmt;
uniform float uVeilBlur; uniform vec3 uVeilCol; uniform sampler2D tPrev; uniform float uCross; varying vec2 vUv;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
float veil(){ vec2 d = abs(vUv * uRes - uVeil.xy) - uVeil.zw; float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  return 1.0 - smoothstep(-uVeilFeather * 0.4, uVeilFeather, sd); }
void main(){
  vec2 c = vUv - 0.5; float r2 = dot(c, c); vec2 off = c * r2 * 0.010;
  float m = veil();
  vec3 col = vec3(texture2D(tScene, vUv + off).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv - off).b);
  col = mix(col, texture2D(tSoft, vUv).rgb, m * uVeilBlur);
  col += texture2D(tBloom1, vUv).rgb * 0.65 + texture2D(tBloom2, vUv).rgb * 0.95;
  col *= uExposure * (1.0 + uFlash * 0.8) * uFade;
  col = aces(col);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  vec3 lo = mix(vec3(0.92, 1.0, 1.09), vec3(1.0, 0.96, 1.05), uDay);
  vec3 hi = mix(vec3(1.05, 1.0, 0.93), vec3(1.06, 1.0, 0.92), uDay);
  col *= mix(lo, hi, smoothstep(0.0, 0.8, l));
  col = pow(col, vec3(0.4545));
  col = mix(col, uVeilCol, m * uVeilAmt);
  // the vignette eases off under the veil, so the page's own colour stays even where the book stands
  col *= mix(1.0, 1.0 - smoothstep(0.30, 0.92, sqrt(r2) * 1.35), uVignette * (1.0 - m * uVeilAmt));
  col += (hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 60.0) - 0.5) * 0.014;
  if(uCross > 0.0) col = mix(col, texture2D(tPrev, vUv).rgb, uCross);
  gl_FragColor = vec4(col, 1.0); }
`;
