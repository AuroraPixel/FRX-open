import * as THREE from 'three';
import type { Shared } from './env';
import { EMBER_ORDER } from './layers';
import type { SceneDesc } from './scene-loader';
import { EMBER_FS, EMBER_VS, FIRE_FS, PLANE_VS, RUNES_FS, SHAFT_FS, SHAFT_VS } from './shaders/scenery.glsl';

// A scene's own lights, as its file declares them (SceneFile.effects): light falling through a window or a cave
// mouth, ground fire glowing through the abyss's mist with embers rising, rings of glowing runes on painted stone.
// They are drawn into the scene buffer, so they bloom and grade with everything else.

// Shafts are drawn after the room's middle pieces and before its near ones; the fire before the floor's drifting
// mist; runes just after the painting they lie on; embers last, behind whatever near painting stands before them.
const SHAFT_ORDER = 2.0;
const FIRE_ORDER = -8.96;
const RUNES_AFTER = 5e-5;
const EMBERS = { count: 420, low: 180 };

interface Fire {
  material: THREE.ShaderMaterial;
  at: THREE.Vector3;
  radius: number;
  y: number;
  strength: number;
}

export class Scenery {
  readonly group = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];
  private readonly shafts: THREE.ShaderMaterial[] = [];
  private readonly fires: Fire[] = [];
  private readonly runes: THREE.ShaderMaterial[] = [];

  constructor(desc: SceneDesc, shared: Shared, random: (name: string) => () => number, low: boolean) {
    const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide } as const;

    // shafts: a strip along the beam, two vertices across at each of nine steps
    for (const shaft of desc.effects.shafts) {
      const steps = 9;
      const q: number[] = [];
      const index: number[] = [];
      for (let i = 0; i < steps; i++) {
        q.push(i / (steps - 1), -1, i / (steps - 1), 1);
        if (i) index.push((i - 1) * 2, (i - 1) * 2 + 1, i * 2, i * 2, (i - 1) * 2 + 1, i * 2 + 1);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(steps * 2 * 3), 3));
      geometry.setAttribute('aQ', new THREE.BufferAttribute(new Float32Array(q), 2));
      geometry.setIndex(index);
      const from = new THREE.Vector3(...shaft.from);
      const to = new THREE.Vector3(...shaft.to);
      const material = new THREE.ShaderMaterial({
        ...additive,
        uniforms: {
          uTime: shared.uTime, uFrom: { value: from }, uTo: { value: to }, uW0: { value: shaft.width },
          uW1: { value: shaft.width * 2.2 }, uK: { value: shaft.strength }, uCol: { value: new THREE.Color() },
          uLen: { value: from.distanceTo(to) },
        },
        vertexShader: SHAFT_VS, fragmentShader: SHAFT_FS,
      });
      material.userData.strength = shaft.strength;
      this.add(new THREE.Mesh(geometry, material), SHAFT_ORDER, geometry, material);
      this.shafts.push(material);
    }

    // ground fire: a plane a little over the floor, and embers
    const seeds = random('embers');
    for (const fire of desc.effects.fire) {
      const at = new THREE.Vector3(...fire.at);
      const geometry = new THREE.PlaneGeometry(fire.radius * 2, fire.radius * 2).rotateX(-Math.PI / 2);
      const material = new THREE.ShaderMaterial({
        ...additive,
        uniforms: { ...shared, uAt: { value: at }, uR: { value: fire.radius }, uK: { value: fire.strength } },
        vertexShader: PLANE_VS, fragmentShader: FIRE_FS,
      });
      const plane = new THREE.Mesh(geometry, material);
      plane.position.copy(at);
      this.add(plane, FIRE_ORDER, geometry, material);
      const count = low ? EMBERS.low : EMBERS.count;
      const embers = new THREE.BufferGeometry();
      const s = new Float32Array(count * 4);
      for (let i = 0; i < s.length; i++) s[i] = seeds();
      embers.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      embers.setAttribute('aSeed', new THREE.BufferAttribute(s, 4));
      const emberMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uTime: shared.uTime, uPx: shared.uPx, uAt: { value: at }, uR: { value: fire.radius }, uK: { value: fire.strength } },
        vertexShader: EMBER_VS, fragmentShader: EMBER_FS,
      });
      this.add(new THREE.Points(embers, emberMat), EMBER_ORDER, embers, emberMat);
      this.fires.push({ material, at, radius: fire.radius, y: at.y, strength: fire.strength });
    }

    // runes: a quad in the painting's plane, squashed to the painted ellipse
    for (const ring of desc.effects.runes) {
      const size = ring.radius * 2.3;
      const geometry = new THREE.PlaneGeometry(size, size * ring.squash);
      const material = new THREE.ShaderMaterial({
        ...additive,
        uniforms: {
          uTime: shared.uTime, uK: { value: ring.strength }, uSquash: { value: ring.squash },
          uCol: { value: new THREE.Color(0.4, 0.95, 0.85) }, uCount: { value: Math.max(12, Math.round(ring.radius * 6)) },
        },
        vertexShader: PLANE_VS, fragmentShader: RUNES_FS,
      });
      material.userData.strength = ring.strength;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...ring.at);
      // after the piece it lies on: the nearest piece at or behind it
      let order = 1;
      for (const piece of desc.pieces) if (piece.z <= ring.at[2] + 1e-6 && piece.paint.order >= 0) order = Math.max(order, piece.renderOrder);
      this.add(mesh, order + RUNES_AFTER, geometry, material);
      this.runes.push(material);
    }
  }

  private add(object: THREE.Object3D, order: number, ...owned: { dispose(): void }[]): void {
    object.renderOrder = order;
    object.frustumCulled = false;
    this.group.add(object);
    this.disposables.push(...owned);
  }

  get hasFire(): boolean {
    return this.fires.length > 0;
  }

  // `key` is the light the shafts carry (the moon's or the sun's colour); `fireLight` takes how ground fire lights the
  // painted layers, `fireAt` where it burns (for the floor's mist).
  update(time: number, key: THREE.Color, day: number, fireLight: THREE.Vector4, fireAt?: THREE.Vector4): void {
    // moonlight through a window is a little weaker than daylight
    const shaftGain = 0.95 + 0.25 * day;
    for (const m of this.shafts) {
      (m.uniforms.uCol!.value as THREE.Color).copy(key).multiplyScalar(shaftGain);
      m.uniforms.uK!.value = m.userData.strength as number;
    }
    // runes glow plainly at night and fade against daylight
    for (const m of this.runes) m.uniforms.uK!.value = (m.userData.strength as number) * (1 - 0.55 * day);
    const fire = this.fires[0];
    if (fire) {
      const flicker = 0.85 + 0.1 * Math.sin(time * 3.7) + 0.05 * Math.sin(time * 9.1 + 1.3);
      fireLight.set(fire.y, 9, 0.9 * fire.strength * flicker, 0);
      fireAt?.set(fire.at.x, fire.at.z, fire.radius, 0);
    } else fireLight.set(0, 1, 0, 0);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
