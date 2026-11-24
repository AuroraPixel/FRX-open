import * as THREE from 'three';
import { approach } from './anim';
import type { Cam } from './scene-loader';
import type { FocusPreset } from './types';

// Below this width-to-height ratio the scene's tall camera set is used.
export const TALL_BELOW = 0.82;

// Presets ease in at 1.7 per second. The camera sways a little (and follows a mouse a little); still(1) quiets that
// to a fifth for reading. Reduced motion and the deterministic mode do not sway. `push` moves the camera along its
// view (a change of scene pushes in a little).
export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(36, 1, 0.1, 1400);
  preset: FocusPreset = 'idle';
  push = 0;
  private cameras: Record<FocusPreset, { wide: Cam; tall: Cam }> | null = null;
  private tall = false;
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private fov = 36;
  private readonly toPos = new THREE.Vector3();
  private readonly toLook = new THREE.Vector3();
  private toFov = 36;
  private still = 0;
  private stillTo = 0;
  private readonly pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  private readonly at = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly view = new THREE.Vector3();

  setCameras(cameras: Record<FocusPreset, { wide: Cam; tall: Cam }>, snap: boolean): void {
    this.cameras = cameras;
    this.focus(this.preset, snap);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    const tall = aspect < TALL_BELOW;
    if (tall !== this.tall) {
      this.tall = tall;
      this.focus(this.preset, false);
    }
  }

  get isTall(): boolean {
    return this.tall;
  }

  focus(preset: FocusPreset, snap: boolean): void {
    this.preset = preset;
    if (!this.cameras) return;
    const pair = this.cameras[preset] ?? this.cameras.idle;
    const c = this.tall ? pair.tall : pair.wide;
    this.toPos.set(c[0], c[1], c[2]);
    this.toLook.set(c[3], c[4], c[5]);
    this.toFov = c[6];
    if (snap) {
      this.pos.copy(this.toPos);
      this.look.copy(this.toLook);
      this.fov = this.toFov;
    }
  }

  setStill(amount: number, snap: boolean): void {
    this.stillTo = Math.min(1, Math.max(0, amount));
    if (snap) this.still = this.stillTo;
  }

  // pointer position in -1..1 across the window
  pointTo(x: number, y: number): void {
    this.pointer.tx = x;
    this.pointer.ty = y;
  }

  update(dt: number, time: number, sway: boolean, shake: number, yaw: number, snap: boolean): void {
    const k = snap ? 1 : 1 - Math.exp(-dt * 1.7);
    this.pos.lerp(this.toPos, k);
    this.look.lerp(this.toLook, k);
    this.fov += (this.toFov - this.fov) * k;
    const p = this.pointer;
    p.x = approach(p.x, p.tx, 3, dt);
    p.y = approach(p.y, p.ty, 3, dt);
    this.still = snap ? this.stillTo : approach(this.still, this.stillTo, 2, dt);
    const live = (sway ? 1 : 0) * (1 - 0.8 * this.still);
    const at = this.at.copy(this.pos);
    at.x += Math.sin(time * 0.11) * 0.35 * live + p.x * 0.7 * live;
    at.y += Math.sin(time * 0.17 + 1.3) * 0.18 * live - p.y * 0.35 * live;
    if (shake > 0.001) {
      // a jitter that is a function of time, so a still of a shaking frame is reproducible
      at.x += (jitter(time * 61.7) - 0.5) * 0.14 * shake;
      at.y += (jitter(time * 47.3 + 9.1) - 0.5) * 0.14 * shake;
    }
    this.target.copy(this.look);
    this.target.x += yaw * 22;
    if (this.push) {
      const view = this.view.copy(this.look).sub(this.pos).normalize();
      at.addScaledVector(view, this.push);
      this.target.addScaledVector(view, this.push);
    }
    this.camera.position.copy(at);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.target);
  }
}

function jitter(x: number): number {
  const s = Math.sin(x * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}
