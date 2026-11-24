import * as THREE from 'three';
import type { HourState, Rgb } from './hours';

// Uniforms every material shares by reference: the hour's light, the effects' levels, time.
export function makeShared() {
  return {
    uTime: { value: 0 },
    uDay: { value: 0 },
    uFog: { value: 0.0058 },
    uFlash: { value: 0 },
    uAura: { value: 0.3 },
    uCharge: { value: 0 },
    uGold: { value: 0 },
    uPillar: { value: 0 },
    uBurst: { value: -1 },
    uBurstGain: { value: 1 },
    uPx: { value: 1 },
    uMoonDir: { value: new THREE.Vector3(0, 0, -1) },
    uSunDir: { value: new THREE.Vector3(0, 0, -1) },
    uLightDir: { value: new THREE.Vector3(0, 0, -1) },
    uCenter: { value: new THREE.Vector3() },
    uMistCol: { value: new THREE.Color(0.1, 0.14, 0.22) },
    uKeyNight: { value: new THREE.Color() },
    uKeyLit: { value: new THREE.Color() },
    uAtmoZen: { value: new THREE.Color() },
    uAtmoHor: { value: new THREE.Color() },
    uAtmoSun: { value: new THREE.Color() },
    uSunGlow: { value: new THREE.Color() },
    uSunCol: { value: new THREE.Color() },
    uHourTint: { value: new THREE.Color() },
    uHourSat: { value: 1 },
    uNightTint: { value: new THREE.Color(1, 1, 1) },
    uNightSat: { value: 1 },
    uCloudDark: { value: new THREE.Color() },
    uCloudLit: { value: new THREE.Color() },
    uAmbLit: { value: new THREE.Color() },
    uFootLit: { value: new THREE.Color() },
    // the formation's presence: 0 at rest, 1 while cultivating or breaking through
    uRing: { value: 0 },
    // a ground haze's colour, and how much the painted layers' low mist takes it instead of the sky's haze
    uGroundCol: { value: new THREE.Color(0.05, 0.065, 0.1) },
    uGroundMix: { value: 0 },
    // the weather's mist over the floor: 0 clear, 1 misty
    uThick: { value: 0 },
    // ground fire lighting what stands low over it: its height, how high the light reaches, strength (flickering)
    uFireLight: { value: new THREE.Vector4(0, 1, 0, 0) },
    // and where it burns: its centre's x and z and its radius (the floor's mist glows over it)
    uFireAt: { value: new THREE.Vector4(0, 0, 1, 0) },
  };
}

export type Shared = ReturnType<typeof makeShared>;

const set = (color: THREE.Color, rgb: Rgb) => color.setRGB(rgb[0], rgb[1], rgb[2]);

// A ground haze is the hour's mist colour taken down: at night by half (a dark blue-grey), in the lit hours to 0.3,
// so a street by day stands in a soft grey haze, not on a white cloud sea.
const GROUND_NIGHT = 0.5;
const GROUND_LIT = 0.3;

// Copy the hour's light into the shared uniforms. `ground` is the scene's ground-haze tint, null without a haze.
export function applyHours(shared: Shared, hours: HourState, fogScale: number, ground: Rgb | null = null): void {
  const { night, lit } = hours;
  shared.uDay.value = hours.day;
  shared.uFog.value = hours.mix('fog') * fogScale;
  const mist: Rgb = [0, 0, 0];
  set(shared.uMistCol.value, hours.mixRgb('mist', mist));
  const d = hours.day;
  const tint = ground ?? [1, 1, 1];
  const g = (i: number) => (night.mist[i]! * GROUND_NIGHT + (lit.mist[i]! * GROUND_LIT - night.mist[i]! * GROUND_NIGHT) * d) * tint[i]!;
  shared.uGroundCol.value.setRGB(g(0), g(1), g(2));
  shared.uGroundMix.value = ground ? 1 : 0;
  set(shared.uKeyNight.value, night.key);
  set(shared.uKeyLit.value, lit.key);
  set(shared.uAtmoZen.value, lit.zenith);
  set(shared.uAtmoHor.value, lit.horizon);
  set(shared.uAtmoSun.value, lit.sunward);
  set(shared.uSunGlow.value, lit.sunGlow);
  set(shared.uSunCol.value, lit.sunColor);
  set(shared.uHourTint.value, lit.tint);
  shared.uHourSat.value = lit.sat;
  set(shared.uNightTint.value, night.tint);
  shared.uNightSat.value = night.sat;
  set(shared.uCloudDark.value, lit.cloudDark);
  set(shared.uCloudLit.value, lit.cloudLit);
  set(shared.uAmbLit.value, lit.ambient);
  set(shared.uFootLit.value, lit.foot);
}

// A direction from degrees right of straight ahead (-z) and degrees above the horizon.
export function dirOf(azimuth: number, elevation: number): THREE.Vector3 {
  const a = (azimuth * Math.PI) / 180;
  const e = (elevation * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}
