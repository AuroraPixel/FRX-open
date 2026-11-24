import * as THREE from 'three';
import { approach } from './anim';
import { dirOf, type Shared } from './env';
import type { HourState } from './hours';
import { paintMaterial } from './layers';
import { DEFAULT_ORDER, resolvePaint, type SceneDesc } from './scene-loader';
import { UV_VS } from './shaders/common.glsl';
import { BIRD_FS, BIRD_VS } from './shaders/world.glsl';
import { SKY_FS, SKY_VS, SUN_FS } from './shaders/paint.glsl';
import type { Textures } from './textures';
import type { Hour, Weather } from './types';

// Where things sit in a sky set, relative to the azimuth the scene turns the panorama to. The sky set's pictures
// were painted for these; scenes only turn the whole sky (SceneFile.sky.azimuth).
const SKY_RADIUS = 900;
const SKY_SPAN = 100;
// The arc reaches higher than its 3:1 picture, which ends some 26 degrees up: above it the picture's top row carries
// on, so the tall cameras that look up (the close-up and the breakthrough's pull-back on a phone) see sky, not black.
const SKY_REACH = 1.8;
const MOON = { azimuth: -2, elevation: 10.6, distance: 880, w: 118, h: 116, file: 'moon.webp' };
const SUN = { azimuth: 3, elevation: 3.2, distance: 870, size: 520 };
const MOONLIGHT = { azimuth: 0, elevation: 6.5 };
// Cranes cross the sky a little left of its middle, about seventy units out and eleven above the eye.
const CRANES = { forward: 68.57, right: -7.43, up: 10.9, speed: 0.35, loop: 60, tallStart: 14 };

export interface SkyLight {
  moonDir: THREE.Vector3;
  sunDir: THREE.Vector3;
}

// The panorama, the moon, the sun's glow and the cranes.
export class Sky {
  readonly group = new THREE.Group();
  readonly light: SkyLight;
  private readonly pano: THREE.Mesh;
  private readonly panoMat: THREE.ShaderMaterial;
  private readonly panoHeight: number;
  private readonly horizon: number;
  private readonly moon: THREE.Mesh | null = null;
  private readonly moonMat: THREE.ShaderMaterial | null = null;
  // asked for with the night (by day there is no moon to show)
  private moonTexture: THREE.Texture | null = null;
  private readonly moonAt: THREE.Vector3;
  private readonly sun: THREE.Mesh;
  private readonly sunMat: THREE.ShaderMaterial;
  private readonly birds: THREE.Mesh | null = null;
  private readonly birdBase = new THREE.Vector3();
  private readonly birdAlong = new THREE.Vector3();
  private readonly disposables: { dispose(): void }[] = [];
  private readonly desc: SceneDesc;
  private readonly textures: Textures;
  private litFile = '';
  private nightFile = '';
  // how far the crossfades from the previous panoramas have gone (a change of weather or of the lit hour)
  private litFade = 1;
  private nightFade = 1;

  constructor(desc: SceneDesc, textures: Textures, shared: Shared) {
    this.desc = desc;
    this.textures = textures;
    const az = desc.sky.azimuth;
    this.light = { moonDir: dirOf(az + MOONLIGHT.azimuth, MOONLIGHT.elevation), sunDir: dirOf(az + SUN.azimuth, SUN.elevation) };
    this.moonAt = dirOf(az + MOON.azimuth, MOON.elevation);
    this.horizon = desc.sky.horizon;

    // the panorama: an arc of a 3:1 picture round the camera, carried with it so it sits at infinity
    const span = (SKY_SPAN * Math.PI) / 180;
    this.panoHeight = (SKY_RADIUS * span) / 3;
    const reach = this.panoHeight * SKY_REACH;
    const geometry = new THREE.CylinderGeometry(SKY_RADIUS, SKY_RADIUS, reach, 72, 1, true, Math.PI - ((az + SKY_SPAN / 2) * Math.PI) / 180, span);
    geometry.translate(0, reach / 2, 0);
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * SKY_REACH);
    const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    black.needsUpdate = true;
    this.panoMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        ...shared,
        tNight: { value: black },
        tNightPrev: { value: black },
        uNightFade: { value: 1 },
        tLit: { value: black },
        tLitPrev: { value: black },
        uLitFade: { value: 1 },
        uGainN: { value: 0.5 },
        uGainLit: { value: 0.62 },
        uSkyTint: { value: new THREE.Color(1, 1, 1) },
        uSkySat: { value: 1 },
      },
      vertexShader: SKY_VS,
      fragmentShader: SKY_FS,
    });
    this.pano = new THREE.Mesh(geometry, this.panoMat);
    this.pano.renderOrder = -10;
    this.pano.frustumCulled = false;
    this.group.add(this.pano);
    this.disposables.push(geometry, this.panoMat, black);

    // the moon: a painted disc far out, facing the camera, gone by day; optional in a sky set
    if (!desc.indoor) {
      const paint = resolvePaint({ type: 'card', file: MOON.file, w: 1, h: 1, x: 0, y: 0, z: 0, gain: 1.15, haze: 0, mist: 0, tintDay: [1, 1, 1], satDay: 1 }, desc.looks.dawn);
      paint.order = DEFAULT_ORDER;
      const moonGeometry = new THREE.PlaneGeometry(1, 1);
      const none = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
      none.needsUpdate = true;
      this.disposables.push(none);
      this.moonMat = paintMaterial(none, paint, false, THREE.DoubleSide, shared);
      this.moon = new THREE.Mesh(moonGeometry, this.moonMat);
      this.moon.scale.set(MOON.w, MOON.h, 1);
      this.moon.renderOrder = -9.6;
      this.moon.frustumCulled = false;
      this.moon.visible = false;
      this.group.add(this.moon);
      this.disposables.push(moonGeometry, this.moonMat);
    }

    const sunGeometry = new THREE.PlaneGeometry(1, 1);
    const sunMat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { ...shared, uVeiled: { value: 0 } },
      vertexShader: UV_VS,
      fragmentShader: SUN_FS,
    });
    this.sunMat = sunMat;
    this.sun = new THREE.Mesh(sunGeometry, sunMat);
    this.sun.scale.set(SUN.size, SUN.size, 1);
    this.sun.renderOrder = -9.5;
    this.sun.frustumCulled = false;
    this.group.add(this.sun);
    this.disposables.push(sunGeometry, sunMat);

    if (!desc.indoor) {
      this.birds = cranes(shared, this.disposables);
      this.group.add(this.birds);
      // the eye stands where the idle camera does
      const idle = desc.cameras.idle.wide;
      const forward = new THREE.Vector3(Math.sin((az * Math.PI) / 180), 0, -Math.cos((az * Math.PI) / 180));
      const right = new THREE.Vector3(-forward.z, 0, forward.x);
      this.birdBase.set(desc.eye[0], idle[1], desc.eye[1]).addScaledVector(forward, CRANES.forward).addScaledVector(right, CRANES.right);
      this.birdBase.y += CRANES.up;
      this.birdAlong.copy(right);
    }
  }

  private pick(hour: Hour, weather: Weather): string {
    const files = this.desc.sky.files;
    const cloudy = weather !== 'clear' && weather !== 'mist';
    return (cloudy && files[hour].cloud) || files[hour].clear;
  }

  // Start loading what an hour and weather show, and only that: at night the night panorama and the moon, in a lit
  // hour its own panorama (the other pole of the light is not drawn while the hour stays). Wait for
  // Textures.settled before setHour.
  preload(hour: Hour, weather: Weather): void {
    if (hour !== 'night') {
      this.textures.get(this.desc.skyFolder + this.pick(hour, weather), true);
      return;
    }
    this.textures.get(this.desc.skyFolder + this.pick('night', weather), true);
    if (this.moonMat && !this.moonTexture) {
      this.moonTexture = this.textures.get(this.desc.skyFolder + MOON.file, false, true);
      this.moonMat.uniforms.tMap!.value = this.moonTexture;
    }
  }

  // Show an hour's panorama, crossfading from the one before (a change of the lit hour, or a cloudy sky coming or
  // going) unless snapping. A change between night and a lit hour is the light's own blend (uDay): each pole keeps
  // the panorama it last showed.
  setHour(hour: Hour, weather: Weather, snap: boolean): void {
    const pick = (h: Hour) => this.pick(h, weather);
    const u = this.panoMat.uniforms;
    if (hour === 'night') {
      const night = pick('night');
      if (night === this.nightFile) return;
      const next = this.textures.get(this.desc.skyFolder + night, true);
      const fade = !!this.nightFile && !snap;
      u.tNightPrev!.value = fade ? u.tNight!.value : next;
      u.tNight!.value = next;
      this.nightFade = fade ? 0 : 1;
      this.nightFile = night;
      return;
    }
    const file = pick(hour);
    if (file !== this.litFile) {
      const next = this.textures.get(this.desc.skyFolder + file, true);
      const fade = !!this.litFile && !snap;
      u.tLitPrev!.value = fade ? u.tLit!.value : next;
      u.tLit!.value = next;
      this.litFade = fade ? 0 : 1;
      this.litFile = file;
    }
  }

  // Run the crossfades on by `seconds` (frames do it with their dt; a still of a change does it once).
  advance(seconds: number): void {
    this.litFade = approach(this.litFade, 1, 1.1, seconds);
    this.nightFade = approach(this.nightFade, 1, 1.1, seconds);
  }

  // `veiled` is how much of the moon and the sun the weather hides (0 clear, 1 overcast).
  update(camera: THREE.Camera, time: number, dt: number, hours: HourState, tall: boolean, veiled = 0): void {
    const u = this.panoMat.uniforms;
    this.advance(dt);
    u.uLitFade!.value = this.litFade;
    u.uNightFade!.value = this.nightFade;
    u.uGainN!.value = hours.night.skyGain;
    u.uGainLit!.value = hours.lit.skyGain;
    const tint = hours.lit.skyTint;
    (u.uSkyTint!.value as THREE.Color).setRGB(tint[0], tint[1], tint[2]);
    u.uSkySat!.value = hours.lit.skySat;

    const p = camera.position;
    this.pano.position.set(p.x, p.y - this.panoHeight * this.horizon, p.z);
    if (this.moon && this.moonMat && this.moonTexture) {
      // a sky set without a moon picture has no moon
      this.moon.visible = !!this.moonTexture.image && hours.day < 0.999;
      this.moon.position.copy(p).addScaledVector(this.moonAt, MOON.distance);
      this.moon.quaternion.copy(camera.quaternion);
      this.moonMat.uniforms.uFade!.value = (1 - hours.day) * (1 - veiled);
    }
    this.sun.position.copy(p).addScaledVector(this.light.sunDir, SUN.distance);
    this.sunMat.uniforms.uVeiled!.value = veiled;
    this.sun.quaternion.copy(camera.quaternion);
    if (this.birds) {
      const along = (tall ? CRANES.tallStart : 0) + ((time * CRANES.speed) % CRANES.loop);
      this.birds.position.copy(this.birdBase).addScaledVector(this.birdAlong, along);
      this.birds.position.y += Math.sin(time * 0.2) * 0.4;
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

// Five cranes in a loose V, flat triangles whose wing tips flap.
function cranes(shared: Shared, disposables: { dispose(): void }[]): THREE.Mesh {
  const pos: number[] = [];
  const flap: number[] = [];
  const phase: number[] = [];
  const tri = (a: number[], b: number[], c: number[], f: number[], ph: number) => {
    [a, b, c].forEach((p, n) => {
      pos.push(p[0]!, p[1]!, p[2]!);
      flap.push(f[n]!);
      phase.push(ph);
    });
  };
  const flock = [[0, 0, 0], [-1.7, -0.35, 0.6], [1.8, -0.3, 0.7], [-3.4, -0.75, 1.3], [3.6, -0.7, 1.5]];
  flock.forEach((o, n) => {
    const ph = n * 1.7;
    const s = 0.95 + (n % 3) * 0.1;
    const P = (x: number, y: number) => [o[0]! + x * s, o[1]! + y * s, o[2]!];
    for (const m of [-1, 1]) {
      tri(P(m * 0.03, 0.06), P(m * 0.03, -0.07), P(m * 0.48, 0.05), [0, 0, 0.5], ph);
      tri(P(m * 0.03, -0.07), P(m * 0.48, -0.03), P(m * 0.48, 0.05), [0, 0.5, 0.5], ph);
      tri(P(m * 0.48, 0.05), P(m * 0.48, -0.03), P(m * 1.0, 0.0), [0.5, 0.5, 1], ph);
    }
    tri(P(0, 0.09), P(0.055, 0), P(-0.055, 0), [0, 0, 0], ph);
    tri(P(0.055, 0), P(0, -0.11), P(-0.055, 0), [0, 0, 0], ph);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geometry.setAttribute('aFlap', new THREE.BufferAttribute(new Float32Array(flap), 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(phase), 1));
  const material = new THREE.ShaderMaterial({ side: THREE.DoubleSide, uniforms: { ...shared }, vertexShader: BIRD_VS, fragmentShader: BIRD_FS });
  disposables.push(geometry, material);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}
