import { ATMO, LIGHT } from './common.glsl';

// The protagonist's back view: a cut-out in the world, turned to the camera. It is first lit as the scenes were
// painted, by the moon: towards grey a little, times the portraits' cold night ambient (界面规范第九节「立绘的受光」).
// Every other hour regrades that the way PAINT_FS regrades a painted layer (the hour's saturation and tint, the
// scene's own corrections included), so it keeps to the scene's light by day as well. Then the side towards the moon
// or sun is a little brighter and a rim lights the silhouette's edge where the light catches it (sampled 1.5, 3.5
// and 7 screen pixels towards the light). The robe, painted a middling blue-grey, is recoloured by uRobe (the wanted
// colour over the painted one). The formation and the gathering qi light it, the feet sink into a ground haze where
// there is one, distance takes the sky's haze.
export const HERO_VS = /* glsl */ `
varying vec2 vUv; varying vec3 vW;
void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
`;

export const HERO_FS = /* glsl */ `
uniform sampler2D tMap; uniform vec3 uRobe; uniform float uGainH; uniform float uRimH; uniform vec2 uL; uniform vec2 uPxUv;
uniform float uA; uniform vec3 uFoot; uniform vec3 uGroundCol; uniform float uGroundMix;
uniform vec3 uHourTint; uniform float uHourSat; uniform vec3 uNightTint; uniform float uNightSat;
varying vec2 vUv; varying vec3 vW;
${ATMO}
${LIGHT}
const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
void main(){
  vec4 t = texture2D(tMap, vUv);
  if(t.a * uA < 0.004) discard;
  vec3 c = pow(t.rgb / max(t.a, 0.004), vec3(2.2));
  float robe = smoothstep(0.012, 0.045, c.b - c.r) * smoothstep(0.03, 0.08, dot(c, LUM));
  c = mix(c, c * uRobe, robe);
  float l = dot(c, LUM);
  vec3 moonlit = mix(vec3(l), c, 0.62) * vec3(0.115, 0.150, 0.250) * uGainH;
  float lm = dot(moonlit, LUM);
  vec3 night = mix(vec3(lm), moonlit, uNightSat) * uNightTint;
  vec3 lit = mix(vec3(lm), moonlit, uHourSat) * uHourTint;
  vec3 base = mix(night, lit, uDay);
  vec3 key = mix(uKeyNight * 1.5, uKeyLit * 1.4, uDay);
  base *= 1.0 + dot(vUv - 0.5, uL) * mix(0.9, 0.7, uDay);
  float e1 = t.a - texture2D(tMap, vUv + uL * uPxUv * 1.5).a;
  float e2 = t.a - texture2D(tMap, vUv + uL * uPxUv * 3.5).a;
  float e3 = t.a - texture2D(tMap, vUv + uL * uPxUv * 7.0).a;
  float rim = clamp(e1, 0.0, 1.0) * 0.55 + clamp(e2, 0.0, 1.0) * 0.35 + clamp(e3, 0.0, 1.0) * 0.15;
  vec3 col = base + key * rim * (0.10 + 0.90 * sqrt(l)) * uGainH * uRimH;
  vec3 to = uCenter + vec3(0.0, 0.5, 0.0) - vW; float d2 = dot(to, to);
  col += (c * 3.0 + 0.015) * auraCol() * auraPower() / (1.0 + d2 * 0.55) * 0.42;
  vec3 view = vW - cameraPosition; float fa = fogAmt(length(view));
  vec3 mist = mix(haze(view), mix(uGroundCol, haze(view), fa), uGroundMix);
  col = mix(col, mist, (1.0 - smoothstep(uFoot.x, uFoot.x + uFoot.y, vW.y)) * uFoot.z * uGroundMix);
  col = mix(col, haze(view), fa * 0.4);
  col += vec3(0.9, 0.86, 0.7) * uFlash * 0.12;
  float a = t.a * uA;
  gl_FragColor = vec4(col * a, a); }
`;

// A soft shadow on the ground under the protagonist, so it stands on something even where the ground is haze.
export const CONTACT_FS = /* glsl */ `
uniform float uA; varying vec2 vUv;
void main(){ vec2 p = (vUv - 0.5) * 2.0; float a = exp(-dot(p, p) * 3.2) * 0.5 * uA * (1.0 - smoothstep(0.85, 1.0, length(p)));
  gl_FragColor = vec4(0.0, 0.0, 0.0, a); }
`;

// The shadow a standing figure casts on a ground haze that lies at its feet: from the feet (v 0) away from the moon
// or the sun (v 1), widest just past the feet, thinning and fading towards its end.
export const CAST_FS = /* glsl */ `
uniform float uA; varying vec2 vUv;
void main(){
  float across = (vUv.x - 0.5) * 2.0; float along = vUv.y;
  float width = mix(0.6, 0.22, along);
  float a = exp(-across * across / (width * width) * 1.6) * pow(1.0 - along, 1.7) * smoothstep(0.0, 0.1, along + 0.03);
  gl_FragColor = vec4(0.0, 0.0, 0.0, a * 0.6 * uA); }
`;
