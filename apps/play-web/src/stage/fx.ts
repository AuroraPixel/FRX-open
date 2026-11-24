import * as THREE from 'three';
import { Timeline, io, lin, out } from './anim';
import type { Shared } from './env';
import type { SceneDesc } from './scene-loader';
import { SOLID_VS, UV_VS } from './shaders/common.glsl';
import {
  BEAM_FS, BLADE_FS, BLADE_GLOW_FS, BLADE_VS, GLOW_FS, MOTES_BURST, MOTES_DRIFT, MOTES_FS, MOTES_STREAM, RING_FS,
  RING_VS, STREAK_FS, WHEEL_FS, motesVs,
} from './shaders/fx.glsl';
import { CLOTH_FS } from './shaders/world.glsl';
import type { CheckOutcome, FocusPreset } from './types';

// `ring` is the formation's presence: it rises while cultivating or breaking through and fades out after. `dodge` and
// `reel` move a fight's opponent: a step aside from a miss, a recoil from a hit (negative: a lunge at the player).
export type FxKey =
  | 'aura' | 'charge' | 'gold' | 'pillar' | 'flash' | 'ring0' | 'ring1' | 'burst' | 'burstGain' | 'yaw' | 'shake'
  | 'sweep' | 'ring' | 'dodge' | 'reel';

export const REST: Record<FxKey, number> = {
  aura: 0.3, charge: 0, gold: 0, pillar: 0, flash: 0, ring0: -1, ring1: -1, burst: -1, burstGain: 1, yaw: 0, shake: 0,
  sweep: -1, ring: 0, dodge: 0, reel: 0,
};

// What a timetable may do to the rest of the stage.
export interface FxControl {
  focus(preset: FocusPreset): void;
  current(): FocusPreset;
}

type V3 = [number, number, number];

// Placement of the effects, relative to the scene's anchors and to the way the sky faces (forward, right, up).
const FORMATION = { halo: { size: 4.3, at: [0, 1.25, -1.7] as V3 }, glow: { size: 9, at: [0, 0.75, -0.6] as V3 }, mark: { size: 4.4, y: -0.02 } };
const SWORD = { turn: -0.227, scale: 1.55, at: [0.6, 1.12, -0.02] as V3 };
const SWEEP = { from: [17.87, -55.96, 12.5] as V3, to: [50.86, 24.69, 4.5] as V3, seconds: 2.1, len: 22, wide: 0.42, gain: 4.0 };
const DISTANT = { first: 9, gapMin: 14, gapMore: 12, seconds: 1.8, len: 26, wide: 0.5, gain: 2.2 };

interface Streak {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

interface Flight {
  start: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
}

// The formation, spirit motes, the hovering sword, the pillar of light and its rings, sword-lights across the sky.
// One per scene (they stand at its anchors); the levels come from the stage's timeline, which outlives scenes.
// The formation (wheel, mark, glow) and the sword are drawn just before and after the protagonist, wherever the
// scene puts it in the draw order, and only while the formation is there.
export class Effects {
  readonly group = new THREE.Group();
  private readonly timeline: Timeline<FxKey>;
  private readonly disposables: { dispose(): void }[] = [];
  private readonly halo: THREE.Mesh;
  private readonly mark: THREE.Mesh;
  private readonly glow: THREE.Mesh;
  private readonly swordRig = new THREE.Group();
  private readonly stream: THREE.Points;
  private readonly burst: THREE.Points;
  private readonly sword = new THREE.Group();
  private readonly beam: THREE.Mesh;
  private readonly rings: { mesh: THREE.Mesh; material: THREE.ShaderMaterial }[] = [];
  private readonly sweep: Streak;
  private readonly distant: Streak;
  private readonly flights: Flight[] = [];
  private readonly flightRandom: () => number;
  private readonly forward: THREE.Vector3;
  private readonly right: THREE.Vector3;
  private readonly eye: THREE.Vector3;
  private readonly aura: THREE.Vector3;
  private readonly sweepFrom: THREE.Vector3;
  private readonly sweepTo: THREE.Vector3;
  private readonly outdoor: boolean;
  private readonly reach: number;

  constructor(desc: SceneDesc, shared: Shared, timeline: Timeline<FxKey>, random: (name: string) => () => number, low: boolean) {
    this.timeline = timeline;
    const [ax, ay, az] = desc.anchors.aura;
    this.aura = new THREE.Vector3(ax, ay, az);
    shared.uCenter.value.copy(this.aura);
    const yaw = (desc.sky.azimuth * Math.PI) / 180;
    this.forward = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
    this.right = new THREE.Vector3(-this.forward.z, 0, this.forward.x);
    this.eye = new THREE.Vector3(desc.eye[0], desc.cameras.idle.wide[1], desc.eye[1]);
    this.outdoor = !desc.indoor;
    this.reach = desc.indoor ? 0.16 : 1;
    this.flightRandom = random('flights');
    const skyward = (base: THREE.Vector3, v: V3) =>
      base.clone().addScaledVector(this.forward, v[0]).addScaledVector(this.right, v[1]).add(new THREE.Vector3(0, v[2], 0));
    this.sweepFrom = skyward(this.aura, SWEEP.from);
    this.sweepTo = skyward(this.aura, SWEEP.to);

    // the formation: a wheel standing behind the cultivator, its mark on the ground, a soft glow between
    const hero = desc.hero.order;
    this.halo = this.wheel(FORMATION.halo.size, 0, hero - 3e-5, shared);
    this.halo.position.copy(this.aura).add(new THREE.Vector3(...FORMATION.halo.at));
    this.mark = this.wheel(FORMATION.mark.size, 1, hero - 1e-5, shared);
    this.mark.rotation.x = -Math.PI / 2;
    this.mark.position.copy(this.aura).add(new THREE.Vector3(0, FORMATION.mark.y, 0));
    this.glow = this.additive(new THREE.PlaneGeometry(FORMATION.glow.size, FORMATION.glow.size), GLOW_FS, shared, hero - 2e-5);
    this.glow.position.copy(this.aura).add(new THREE.Vector3(...FORMATION.glow.at));

    // spirit motes: drifting always, streaming in while cultivating, bursting out on a breakthrough
    const seeds = random('motes');
    this.points(low ? 120 : 220, MOTES_DRIFT, shared, seeds);
    this.stream = this.points(low ? 600 : 1500, MOTES_STREAM, shared, seeds);
    this.burst = this.points(low ? 260 : 520, MOTES_BURST, shared, seeds);

    this.buildSword(desc, shared);

    this.beam = this.additive(new THREE.PlaneGeometry(10, 120), BEAM_FS, shared, 5);
    this.beam.position.copy(this.aura).add(new THREE.Vector3(0, 60, 0));
    // the rings run out over the floor, or along a room's own floor; never above the cultivator's own ground (a haze
    // that lies at the feet)
    const ringY = desc.floor ? Math.min(desc.floor.y + 1.5, ay + 0.02) : ay + 0.02;
    for (let i = 0; i < 2; i++) {
      const geometry = new THREE.RingGeometry(0.955, 1.0, 128).rotateX(-Math.PI / 2);
      const material = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uA: { value: 0 }, uGold: shared.uGold }, vertexShader: RING_VS, fragmentShader: RING_FS,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(ax, ringY, az);
      mesh.renderOrder = 5;
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.rings.push({ mesh, material });
      this.disposables.push(geometry, material);
    }
    this.sweep = this.streak();
    this.distant = this.streak();
  }

  private additive(geometry: THREE.BufferGeometry, fragmentShader: string, shared: Shared, order: number, extra = {}): THREE.Mesh {
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { ...shared, ...extra }, vertexShader: UV_VS, fragmentShader,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.disposables.push(geometry, material);
    return mesh;
  }

  private wheel(size: number, flat: number, order: number, shared: Shared): THREE.Mesh {
    return this.additive(new THREE.PlaneGeometry(size, size), WHEEL_FS, shared, order, { uFlat: { value: flat } });
  }

  private points(count: number, body: string, shared: Shared, random: () => number): THREE.Points {
    const geometry = new THREE.BufferGeometry();
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = random();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { ...shared }, vertexShader: motesVs(body), fragmentShader: MOTES_FS,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 4;
    this.group.add(points);
    this.disposables.push(geometry, material);
    return points;
  }

  // The flying sword hovers point down at the cultivator's shoulder, there only with the formation.
  private buildSword(desc: SceneDesc, shared: Shared): void {
    const rig = this.swordRig;
    rig.position.set(...desc.anchors.player);
    rig.rotation.y = SWORD.turn;
    rig.scale.setScalar(SWORD.scale);
    // premultiplied, so the solid parts fade with the formation
    const fading = {
      side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    } as const;
    const bladeMat = new THREE.ShaderMaterial({ ...fading, uniforms: { ...shared }, vertexShader: BLADE_VS, fragmentShader: BLADE_FS });
    const gold = new THREE.ShaderMaterial({
      ...fading, uniforms: { ...shared, uTint: { value: new THREE.Color(0.55, 0.45, 0.25) }, uSheen: { value: 1 } },
      vertexShader: SOLID_VS, fragmentShader: CLOTH_FS,
    });
    const blade = new THREE.PlaneGeometry(0.042, 0.62).translate(0, -0.31, 0);
    const tip = new THREE.BufferGeometry();
    tip.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.021, -0.62, 0, 0.021, -0.62, 0, 0, -0.73, 0]), 3));
    const guardGeometry = new THREE.BoxGeometry(0.14, 0.022, 0.03);
    const gripGeometry = new THREE.CylinderGeometry(0.011, 0.011, 0.15, 8);
    const order = desc.hero.order + 2e-5;
    const edge = new THREE.Mesh(blade, bladeMat);
    const point = new THREE.Mesh(tip, bladeMat);
    const guard = new THREE.Mesh(guardGeometry, gold);
    const grip = new THREE.Mesh(gripGeometry, gold);
    for (const part of [edge, point, guard, grip]) part.renderOrder = order;
    guard.position.y = 0.01;
    grip.position.y = 0.095;
    this.sword.add(edge, point, guard, grip);
    const glowGeometry = new THREE.PlaneGeometry(0.6, 1.4);
    const glowMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { ...shared }, vertexShader: UV_VS, fragmentShader: BLADE_GLOW_FS,
    });
    const glow = new THREE.Mesh(glowGeometry, glowMat);
    glow.position.set(0, -0.3, -0.01);
    glow.renderOrder = order + 1e-5;
    this.sword.add(glow);
    this.sword.position.set(...SWORD.at);
    rig.add(this.sword);
    this.group.add(rig);
    this.disposables.push(bladeMat, gold, blade, tip, guardGeometry, gripGeometry, glowGeometry, glowMat);
  }

  private streak(): Streak {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uI: { value: 0 } }, vertexShader: UV_VS, fragmentShader: STREAK_FS,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    mesh.renderOrder = 6;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.disposables.push(geometry, material);
    return { mesh, material };
  }

  private fly(streak: Streak, from: THREE.Vector3, to: THREE.Vector3, u: number, len: number, wide: number, gain: number): void {
    streak.mesh.visible = u >= 0 && u < 1;
    if (!streak.mesh.visible) return;
    streak.mesh.position.copy(from).lerp(to, io(u));
    streak.mesh.rotation.z = Math.atan2(to.y - from.y, to.x - from.x);
    streak.mesh.scale.set(len, wide, 1);
    streak.material.uniforms.uI!.value = Math.sin(Math.PI * u) * gain;
  }

  // Distant sword-lights cross the sky every so often; when is a function of time, so a still is reproducible.
  private flightAt(time: number): Flight | null {
    if (!this.outdoor) return null;
    while (!this.flights.length || this.flights[this.flights.length - 1]!.start <= time) {
      const last = this.flights[this.flights.length - 1];
      const r = this.flightRandom;
      const start = last ? last.start + DISTANT.gapMin + r() * DISTANT.gapMore : DISTANT.first;
      const up = 14.7 + r() * 26;
      const side = r() < 0.5 ? 1 : -1;
      const from = this.eye.clone().addScaledVector(this.forward, 160 + r() * 60).addScaledVector(this.right, -100 * side);
      from.y += up;
      const to = this.eye.clone().addScaledVector(this.forward, 175).addScaledVector(this.right, 80 * side);
      to.y += up - 8 - r() * 10;
      this.flights.push({ start, from, to });
      if (this.flights.length > 8) this.flights.shift();
    }
    for (const f of this.flights) if (time >= f.start && time < f.start + DISTANT.seconds) return f;
    return null;
  }

  // `ring` is the formation's presence this frame (0 where the scene has none)
  update(time: number, camera: THREE.Camera, ring: number): void {
    const A = this.timeline.values;
    const formed = ring > 0.002;
    this.halo.visible = formed;
    this.mark.visible = formed;
    this.glow.visible = formed;
    this.swordRig.visible = formed;
    this.stream.visible = A.charge > 0.002;
    this.burst.visible = A.burst >= 0 && A.burst < 1;
    this.beam.visible = A.pillar > 0.002;
    this.rings.forEach((ring, r) => {
      const q = r === 0 ? A.ring0 : A.ring1;
      ring.mesh.visible = q >= 0 && q < 1;
      if (!ring.mesh.visible) return;
      // a room's rings stay a ripple across its floor; outdoors they run out over the clouds
      const s = 1 + out(q) * (62 + r * 30) * this.reach;
      ring.mesh.scale.set(s, 1, s);
      ring.material.uniforms.uA!.value = Math.pow(1 - q, 1.5) * 2.0;
    });
    const flight = this.flightAt(time);
    if (flight) this.fly(this.distant, flight.from, flight.to, (time - flight.start) / DISTANT.seconds, DISTANT.len, DISTANT.wide, DISTANT.gain);
    else this.distant.mesh.visible = false;
    this.fly(this.sweep, this.sweepFrom, this.sweepTo, A.sweep, SWEEP.len, SWEEP.wide, SWEEP.gain);
    this.sword.position.y = SWORD.at[1] + Math.sin(time * 1.1) * 0.03;
    this.sword.rotation.y = Math.sin(time * 0.5) * 0.45;
    this.halo.quaternion.copy(camera.quaternion);
    this.glow.quaternion.copy(camera.quaternion);
    this.beam.rotation.y = Math.atan2(camera.position.x - this.aura.x, camera.position.z - this.aura.z);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

// The effects' timetables (界面规范第九节「特效的时间表」), played on the stage's timeline.
export class Timetables {
  private readonly timeline: Timeline<FxKey>;
  private pending: (() => void)[] = [];

  constructor(timeline: Timeline<FxKey>) {
    this.timeline = timeline;
  }

  // Ends whatever was playing: its promise resolves and the stage calms down.
  private restart(): void {
    this.timeline.clear();
    const done = this.pending;
    this.pending = [];
    for (const resolve of done) resolve();
  }

  private finish(seconds: number): Promise<void> {
    return new Promise((resolve) => {
      this.pending.push(resolve);
      this.timeline.later(seconds, () => {
        this.pending = this.pending.filter((r) => r !== resolve);
        resolve();
      });
    });
  }

  private calm(): void {
    const A = this.timeline.values;
    A.pillar = 0;
    A.flash = 0;
    A.burst = -1;
    A.burstGain = 1;
    A.ring0 = -1;
    A.ring1 = -1;
    A.shake = 0;
    A.dodge = 0;
    A.reel = 0;
  }

  private restAura(): number {
    return this.timeline.values.gold > 0.5 ? 0.6 : 0.3;
  }

  cultivate(seconds: number, ctl: FxControl): Promise<void> {
    this.restart();
    const back = ctl.current();
    const t = this.timeline;
    const sec = Math.max(2.2, seconds);
    ctl.focus('cult');
    t.tween('ring', 1, 0.8);
    t.tween('ring', 0, 1.2, sec - 1.2);
    t.tween('charge', 1, 0.8);
    t.tween('charge', 0, 1.2, sec - 1.2);
    t.tween('aura', 0.8, 0.8);
    t.tween('aura', this.restAura(), 1.4, sec - 0.9);
    t.later(sec, () => {
      if (ctl.current() === 'cult') ctl.focus(back === 'cult' ? 'read' : back);
    });
    return this.finish(sec + 0.5);
  }

  breakthrough(success: boolean, ctl: FxControl): Promise<void> {
    this.restart();
    this.calm();
    const back = ctl.current();
    const t = this.timeline;
    const A = t.values;
    ctl.focus('cine1');
    t.tween('ring', 1, 1.1);
    t.tween('charge', 1, 1.1);
    t.tween('aura', 1.0, 1.1);
    if (success) {
      t.tween('gold', 1, 0.6, 1.0);
      t.tween('pillar', 1, 0.4, 1.3, out);
      t.tween('flash', 1, 0.12, 1.3, out);
      t.tween('flash', 0, 1.1, 1.46);
      t.tween('shake', 1, 0.1, 1.3, out);
      t.tween('shake', 0, 1.3, 1.46);
      t.tween('burst', 1, 2.4, 1.35, out, 0, () => (A.burst = -1));
      t.tween('ring0', 1, 3.4, 1.35, lin, 0, () => (A.ring0 = -1));
      t.tween('ring1', 1, 4.4, 2.2, lin, 0, () => (A.ring1 = -1));
      t.tween('charge', 0.25, 1.4, 2.4);
      t.tween('pillar', 0, 2.4, 5.4);
      t.tween('aura', 0.6, 2.0, 5.4);
      t.tween('charge', 0, 2.0, 5.4);
      t.tween('ring', 0, 2.0, 5.4);
    } else {
      // no turn to gold and no pillar: the gathered qi scatters at 1.3 s and the picture dims
      t.tween('charge', 0, 0.25, 1.3, out);
      t.tween('aura', 0.3, 1.6, 1.3);
      t.tween('ring', 0, 1.6, 1.3);
      t.tween('flash', -0.6, 0.12, 1.3, out);
      t.tween('flash', 0, 1.1, 1.46);
      t.tween('shake', 0.6, 0.1, 1.3, out);
      t.tween('shake', 0, 1.0, 1.46);
      t.later(1.3, () => (A.burstGain = 0.45));
      t.tween('burst', 1, 2.0, 1.32, out, 0, () => {
        A.burst = -1;
        A.burstGain = 1;
      });
    }
    t.later(2.5, () => ctl.focus('cine2'));
    t.later(6.5, () => ctl.focus(back === 'cine1' || back === 'cine2' ? 'read' : back));
    return this.finish(6.5);
  }

  swordLight(): Promise<void> {
    const t = this.timeline;
    t.tween('sweep', 1, SWEEP.seconds, 0, lin, 0, () => (t.values.sweep = -1));
    t.tween('yaw', -0.09, 1.0);
    t.tween('yaw', 0, 1.7, 1.25);
    return this.finish(2.95);
  }

  check(outcome: CheckOutcome): Promise<void> {
    const t = this.timeline;
    const peak = { success: 0.35, critical_success: 0.7, failure: -0.25, critical_failure: -0.45 }[outcome];
    t.tween('flash', peak, 0.08, 0, out);
    t.tween('flash', 0, 0.6, 0.1);
    if (outcome.startsWith('critical')) {
      t.tween('shake', 0.45, 0.06, 0, out);
      t.tween('shake', 0, 0.5, 0.08);
    }
    return this.finish(0.75);
  }

  // One exchange of a fight (界面规范第七节「交锋」): a hit on the foe flashes the picture and shakes it (0.1 s up, 1.3 s
  // down) while the foe reels back; a miss makes the foe step aside and back. The foe striking at the player lunges,
  // and a hit darkens the picture instead of brightening it. Several in a row overlap without restarting the stage.
  strike(hit: boolean, at: 'foe' | 'player'): Promise<void> {
    const t = this.timeline;
    if (at === 'foe') {
      if (hit) {
        t.tween('flash', 0.42, 0.1, 0, out);
        t.tween('flash', 0, 1.3, 0.1);
        t.tween('shake', 0.55, 0.1, 0, out);
        t.tween('shake', 0, 1.3, 0.1);
        t.tween('reel', 1, 0.09, 0, out);
        t.tween('reel', 0, 0.7, 0.14);
      } else {
        t.tween('dodge', 1, 0.2, 0, out);
        t.tween('dodge', 0, 0.6, 0.38);
      }
      return this.finish(1.45);
    }
    t.tween('reel', -1, 0.16, 0, out);
    t.tween('reel', 0, 0.6, 0.22);
    if (hit) {
      t.tween('flash', -0.4, 0.1, 0.12, out);
      t.tween('flash', 0, 1.1, 0.24);
      t.tween('shake', 0.6, 0.1, 0.12, out);
      t.tween('shake', 0, 1.3, 0.24);
    }
    return this.finish(1.55);
  }

  // after a breakthrough: the motes stay gold, the formation is gone
  settle(): void {
    this.restart();
    this.calm();
    const A = this.timeline.values;
    A.charge = 0;
    A.gold = 1;
    A.aura = 0.6;
    A.ring = 0;
  }

  reset(): Promise<void> {
    this.restart();
    this.calm();
    const t = this.timeline;
    t.values.charge = 0;
    t.values.yaw = 0;
    t.tween('gold', 0, 1.2);
    t.tween('aura', 0.3, 1.2);
    t.tween('ring', 0, 1.2);
    return this.finish(1.2);
  }

  dispose(): void {
    this.restart();
  }
}
