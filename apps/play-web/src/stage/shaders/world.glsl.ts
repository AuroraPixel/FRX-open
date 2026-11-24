import { ATMO, LIGHT, NOISE } from './common.glsl';

// The stage's own floor: one solid plane and drifting translucent layers above it. A sea of cloud (uKind 0) has lit
// cloud tops and a path of light towards the moon or sun; a ground haze (uKind 1) is soft patches in the ground's
// colour (uGroundCol, already tinted), thin enough that the painted ground reads through the drifting layers.
// uTint and uK are the scene's tint and strength; uThick is the weather's mist.
export const FLOOR_VS = /* glsl */ `
varying vec3 vW;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
`;

export const FLOOR_FS = /* glsl */ `
uniform float uTime; uniform float uLayer; uniform vec3 uCloudDark; uniform vec3 uCloudLit; uniform float uKind;
uniform vec3 uTint; uniform float uK; uniform float uThick; uniform vec3 uGroundCol; uniform vec4 uFireLight;
uniform vec4 uFireAt; varying vec3 vW;
${NOISE}
${ATMO}
${LIGHT}
void main(){
  vec2 p = vW.xz * 0.034 + vec2(uTime * 0.010, uTime * 0.005) * (1.0 + uLayer * 0.5) + uLayer * 17.3;
  float n = fbm(p);
  float n2 = fbm(p * 2.4 + vec2(n * 1.6, -uTime * 0.012));
  float body = n * 0.62 + n2 * 0.38;
  vec3 view = vW - cameraPosition; float dist = length(view.xz);
  vec3 col; float dens; float alpha;
  if(uKind < 0.5){
    dens = smoothstep(0.36 + uLayer * 0.07, 0.74, body);
    vec2 ld = normalize(uLightDir.xz);
    float nl = fbm(p + ld * 0.16);
    float shade = clamp((n - nl) * 4.5 + 0.5, 0.0, 1.3);
    vec3 dark = mix(vec3(0.020, 0.032, 0.060), uCloudDark, uDay);
    vec3 lit = mix(vec3(0.21, 0.29, 0.44), uCloudLit, uDay);
    col = mix(dark, lit, shade * (0.30 + 0.70 * dens));
    float toward = max(dot(normalize(view.xz), ld), 0.0);
    float path = pow(toward, 60.0) * (0.25 + 0.75 * shade) * smoothstep(0.25, 0.75, body);
    col = (col + keyCol() * path * mix(0.55, 0.90, uDay)) * uTint;
    alpha = uLayer < 0.5 ? 1.0 : min(1.0, mix(dens, 1.0, smoothstep(70.0, 240.0, dist)) * 0.85 * uK * (1.0 + 0.4 * uThick));
  } else {
    dens = smoothstep(0.30, 0.80, body);
    col = uGroundCol * (0.78 + 0.5 * body) + keyCol() * dens * 0.012 * uDay;
    // the drifting wisps catch a little more light than the haze they drift over
    if(uLayer > 0.5) col = col * 1.35 + haze(view) * 0.06;
    col = mix(col, haze(view), 0.25 * uThick);
    alpha = uLayer < 0.5 ? 1.0 : min(1.0, dens * 0.36 * uK * (1.0 + 0.8 * uThick));
  }
  if(uFireLight.z > 0.0){
    // over ground fire the mist is lit from below: the floor darkens to a smoky red, the drifting layers glow most
    // where they are thin, and less by day
    // in broad patches, where the fire below burns hottest
    float spots = smoothstep(0.3, 0.75, fbm(vec2(vW.x * 0.03, vW.z * 0.012) + vec2(5.0, uTime * 0.004)));
    float over = (1.0 - smoothstep(0.15, 1.0, length((vW.xz - uFireAt.xy) / uFireAt.z))) * (0.3 + 0.7 * spots);
    float night = 1.0 - 0.55 * uDay;
    col = mix(col, col * vec3(0.42, 0.27, 0.28), over * 0.8 * night);
    col += vec3(0.34, 0.06, 0.012) * over * uFireLight.z * night * (uLayer < 0.5 ? 1.0 : 0.15 + 0.55 * (1.0 - dens));
  }
  vec3 toC = vW - uCenter; float dc = dot(toC.xz, toC.xz);
  col += auraCol() * (uPillar * 0.55 + uCharge * 0.10) / (1.0 + dc * 0.006) * (0.4 + 0.6 * dens);
  col = mix(col, haze(view), fogAmt(dist));
  col += vec3(0.9, 0.86, 0.7) * uFlash * 0.2 * dens;
  gl_FragColor = vec4(col, alpha); }
`;

// Cranes far out, seen from behind.
export const BIRD_VS = /* glsl */ `
attribute float aFlap; attribute float aPhase; uniform float uTime; varying vec3 vW;
void main(){ vec3 p = position; p.y += aFlap * (sin(uTime * 5.5 + aPhase) * 0.36 + 0.10);
  vec4 q = modelMatrix * vec4(p, 1.0); vW = q.xyz; gl_Position = projectionMatrix * viewMatrix * q; }
`;

export const BIRD_FS = /* glsl */ `
varying vec3 vW;
${ATMO}
void main(){ vec3 view = vW - cameraPosition; vec3 col = mix(vec3(0.012, 0.016, 0.026), vec3(0.10, 0.10, 0.14), uDay);
  col = mix(col, haze(view), fogAmt(length(view)) * 0.8); gl_FragColor = vec4(col, 1.0); }
`;

// Lit solids: the sword's guard and grip. They come and go with the formation (uRing).
export const CLOTH_FS = /* glsl */ `
varying vec3 vW; varying vec3 vN; uniform vec3 uTint; uniform float uSheen;
${ATMO}
${LIGHT}
void main(){
  vec3 n = normalize(vN); if(!gl_FrontFacing) n = -n;
  vec3 v = normalize(cameraPosition - vW);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0) * uSheen;
  float ndl = dot(n, uLightDir);
  vec3 amb = mix(vec3(0.11, 0.17, 0.31), vec3(0.26, 0.28, 0.40), uDay) * (0.6 + 0.4 * n.y);
  vec3 col = uTint * (amb + keyCol() * max(ndl, 0.0) * 1.5);
  col += keyCol() * fres * max(ndl * 0.5 + 0.6, 0.0) * 0.50;
  vec3 al = auraLight(vW, n);
  col += (uTint * 3.0 + 0.03 * uSheen) * al + auraCol() * fres * (uCharge * 0.45 + uPillar * 1.4);
  gl_FragColor = vec4(col * uRing, uRing); }
`;
