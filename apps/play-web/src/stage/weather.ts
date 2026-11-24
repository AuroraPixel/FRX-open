import * as THREE from 'three';
import type { Shared } from './env';
import { WEATHER_ORDER } from './layers';
import { RAIN_FS, RAIN_VS, SNOW_FS, SNOW_VS } from './shaders/weather.glsl';

// Rain and snow, all on the GPU: every drop or flake has a fixed random seed and its place is a function of time,
// wrapped in a box that follows the camera, so nothing is updated per particle on the CPU. The counts are fixed
// (fewer on phones and small machines); the weather's level shows that fraction of them, so rain thickens and thins
// smoothly. Rain is drawn as thin streaks along its fall, snow as soft points.
//
// They are drawn last in the scene and test the depth the nearer paintings and the protagonist leave (DEPTH_ORDER),
// so they fall behind what stands in front of them. With a portrait on the stage they are drawn in two parts: what
// lies beyond the portrait with the scene (`behind`), and what falls between it and the camera over it (`front`).
const RAIN = { count: 6400, low: 2400, box: [56, 26, 32] as const };
const SNOW = { count: 5200, low: 1900, box: [48, 22, 28] as const };

export interface PrecipitationLevels {
  rain: number;
  snow: number;
}

export class Precipitation {
  readonly group = new THREE.Group();
  private readonly rain: THREE.Mesh;
  private readonly rainMat: THREE.ShaderMaterial;
  private readonly snow: THREE.Points;
  private readonly snowMat: THREE.ShaderMaterial;
  private readonly disposables: { dispose(): void }[] = [];
  private readonly forward = new THREE.Vector3();
  // the depths (from the camera) drawn now: [nearest, farthest)
  private readonly range = { value: new THREE.Vector2(0, 1e9) };

  constructor(shared: Shared, random: (name: string) => () => number, low: boolean) {
    const r = random('weather');
    // rain: four corners per drop, two triangles
    const drops = low ? RAIN.low : RAIN.count;
    const seeds = new Float32Array(drops * 4 * 4);
    const corners = new Float32Array(drops * 4 * 2);
    const index = new Uint32Array(drops * 6);
    for (let i = 0; i < drops; i++) {
      const s = [r(), r(), r(), r()];
      for (let k = 0; k < 4; k++) {
        seeds.set(s, (i * 4 + k) * 4);
        corners.set([k % 2 ? 1 : -1, k < 2 ? 0 : 1], (i * 4 + k) * 2);
      }
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    }
    const rainGeometry = new THREE.BufferGeometry();
    rainGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(drops * 4 * 3), 3));
    rainGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    rainGeometry.setAttribute('aCorner', new THREE.BufferAttribute(corners, 2));
    rainGeometry.setIndex(new THREE.BufferAttribute(index, 1));
    this.rainMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: shared.uTime, uPx: shared.uPx, uLevel: { value: 0 }, uBoxLo: { value: new THREE.Vector3() },
        uBox: { value: new THREE.Vector3(...RAIN.box) }, uPxK: { value: 500 }, uCol: { value: new THREE.Color() },
        uRange: this.range,
      },
      vertexShader: RAIN_VS, fragmentShader: RAIN_FS,
    });
    this.rain = new THREE.Mesh(rainGeometry, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = WEATHER_ORDER;
    this.rain.visible = false;

    const flakes = low ? SNOW.low : SNOW.count;
    const flakeSeeds = new Float32Array(flakes * 4);
    for (let i = 0; i < flakeSeeds.length; i++) flakeSeeds[i] = r();
    const snowGeometry = new THREE.BufferGeometry();
    snowGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(flakes * 3), 3));
    snowGeometry.setAttribute('aSeed', new THREE.BufferAttribute(flakeSeeds, 4));
    this.snowMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: {
        uTime: shared.uTime, uPx: shared.uPx, uLevel: { value: 0 }, uBoxLo: { value: new THREE.Vector3() },
        uBox: { value: new THREE.Vector3(...SNOW.box) }, uCol: { value: new THREE.Color() }, uRange: this.range,
      },
      vertexShader: SNOW_VS, fragmentShader: SNOW_FS,
    });
    this.snow = new THREE.Points(snowGeometry, this.snowMat);
    this.snow.frustumCulled = false;
    this.snow.renderOrder = WEATHER_ORDER;
    this.snow.visible = false;
    this.group.add(this.rain, this.snow);
    this.disposables.push(rainGeometry, this.rainMat, snowGeometry, this.snowMat);
  }

  // Whether any rain or snow falls this frame (after update).
  get falling(): boolean {
    return this.rain.visible || this.snow.visible;
  }

  // Draw only what lies beyond `depth` (behind a portrait standing that far from the camera; 0: everything), or only
  // what lies nearer than it (in front of the portrait).
  behind(depth: number): void {
    this.range.value.set(depth, 1e9);
  }

  front(depth: number): void {
    this.range.value.set(0, depth);
  }

  // The levels (0..1) and the light they catch this frame; `day` blends the night's colour into the lit hours'.
  update(camera: THREE.PerspectiveCamera, levels: PrecipitationLevels, night: THREE.Color, lit: THREE.Color, day: number, bufferHeight: number): void {
    this.rain.visible = levels.rain > 0.004;
    this.snow.visible = levels.snow > 0.004;
    if (!this.rain.visible && !this.snow.visible) return;
    camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    this.forward.normalize();
    const place = (material: THREE.ShaderMaterial, box: readonly [number, number, number]) => {
      const lo = material.uniforms.uBoxLo!.value as THREE.Vector3;
      lo.copy(camera.position).addScaledVector(this.forward, box[2] / 2 + 1.2);
      lo.x -= box[0] / 2;
      lo.z -= box[2] / 2;
      lo.y -= box[1] * 0.6;
    };
    const colour = (material: THREE.ShaderMaterial, gain: number) =>
      (material.uniforms.uCol!.value as THREE.Color).copy(night).lerp(lit, day).multiplyScalar(gain);
    if (this.rain.visible) {
      place(this.rainMat, RAIN.box);
      this.rainMat.uniforms.uLevel!.value = levels.rain;
      // pixels per world unit at one unit of depth, for the streaks' least width
      this.rainMat.uniforms.uPxK!.value = bufferHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
      colour(this.rainMat, 1.8);
    }
    if (this.snow.visible) {
      place(this.snowMat, SNOW.box);
      this.snowMat.uniforms.uLevel!.value = levels.snow;
      colour(this.snowMat, 2.8);
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
