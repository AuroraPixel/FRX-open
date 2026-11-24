// Rain and snow. A particle's place is its seed spread over the box, moved by its velocity times the time, wrapped
// into the box (uBoxLo, uBox) that follows the camera: each one stays put in the world while the box slides. Near
// ones fade before they fill the screen, far ones before the box's end shows. uRange picks the particles by their
// depth from the camera (the head's, so a streak is never split): [nearest, farthest).

// Rain: a quad per drop, its two far corners trailing the drop along its fall, at least ~0.8 px wide.
export const RAIN_VS = /* glsl */ `
attribute vec4 aSeed; attribute vec2 aCorner;
uniform float uTime; uniform float uLevel; uniform vec3 uBoxLo; uniform vec3 uBox; uniform float uPxK; uniform vec2 uRange;
varying float vA; varying float vX;
void main(){
  float speed = 12.0 + aSeed.w * 7.0;
  vec3 vel = vec3(1.7, -speed, 0.5);
  vec3 p = uBoxLo + mod(aSeed.xyz * uBox + vel * uTime - uBoxLo, uBox);
  vec3 dir = normalize(vel);
  vec3 at = p - dir * (0.45 + aSeed.w * 0.55) * aCorner.y;
  vec4 mv = viewMatrix * vec4(at, 1.0);
  vec3 dv = (viewMatrix * vec4(dir, 0.0)).xyz;
  vec2 across = normalize(vec2(-dv.y, dv.x) + vec2(1e-5, 0.0));
  float depth = max(-mv.z, 0.1);
  float head = -(viewMatrix * vec4(p, 1.0)).z;
  mv.xy += across * aCorner.x * max(0.007, 1.1 * depth / uPxK) * 0.5;
  gl_Position = projectionMatrix * mv;
  float shown = step(fract(aSeed.y * 37.0 + aSeed.x * 11.0), uLevel) * step(uRange.x, head) * (1.0 - step(uRange.y, head));
  // a drop not shown now is put outside the view, so it costs no pixels
  if(shown < 0.5) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
  vA = shown * smoothstep(1.2, 3.5, depth) * (1.0 - smoothstep(20.0, 31.0, depth)) * (0.6 + 0.4 * aSeed.w);
  vX = aCorner.x; }
`;

export const RAIN_FS = /* glsl */ `
uniform vec3 uCol; varying float vA; varying float vX;
void main(){ gl_FragColor = vec4(uCol * vA * (1.0 - vX * vX) * 0.32, 1.0); }
`;

// Snow: soft points drifting down with a slow sway.
export const SNOW_VS = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime; uniform float uLevel; uniform vec3 uBoxLo; uniform vec3 uBox; uniform float uPx; uniform vec2 uRange;
varying float vA;
void main(){
  float fall = 0.7 + aSeed.w * 0.9;
  vec3 move = vec3(0.45 * uTime + sin(uTime * (0.5 + aSeed.w * 0.6) + aSeed.x * 40.0) * 0.55,
                   -fall * uTime,
                   cos(uTime * (0.4 + aSeed.y * 0.5) + aSeed.z * 30.0) * 0.4);
  vec3 p = uBoxLo + mod(aSeed.xyz * uBox + move - uBoxLo, uBox);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = max(-mv.z, 0.1);
  gl_PointSize = (2.4 + aSeed.w * 3.6) * uPx * (16.0 / depth);
  float shown = step(fract(aSeed.y * 37.0 + aSeed.x * 11.0), uLevel) * step(uRange.x, depth) * (1.0 - step(uRange.y, depth));
  if(shown < 0.5) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
  vA = shown * smoothstep(1.0, 3.0, depth) * (1.0 - smoothstep(18.0, 27.0, depth)); }
`;

export const SNOW_FS = /* glsl */ `
uniform vec3 uCol; varying float vA;
void main(){ float d = length(gl_PointCoord - 0.5); float a = (1.0 - smoothstep(0.28, 0.5, d)) * vA * 0.9;
  gl_FragColor = vec4(uCol * a, a); }
`;
