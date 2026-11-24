import { io, out } from './anim';

// A change of scene (执行计划第 58 项, 「演出」: 旧场景暗下去、新场景亮起来，镜头轻推). With motion: the old scene darkens
// while the camera pushes in a little; the new one is swapped in while dark and comes up as the camera, set back by
// a little, eases forward to its place. With reduced motion: the old picture is kept and crossfaded into the new.
// The values are functions of the time into the phase, so a still can show any moment of a change.
export const SWITCH = {
  // seconds
  out: 0.55,
  in: 1.1,
  cross: 0.9,
  // world units along the camera's view
  pushOut: 0.7,
  pushIn: 0.8,
};

export type Phase = 'idle' | 'out' | 'hold' | 'in' | 'cross';

export class Transition {
  phase: Phase = 'idle';
  t = 0;
  // fading back after a failed change: no push
  private still = false;

  // The picture's brightness: dark at the swap.
  get fade(): number {
    switch (this.phase) {
      case 'out':
        return 1 - io(Math.min(1, this.t / SWITCH.out));
      case 'hold':
        return 0;
      case 'in':
        return io(Math.min(1, this.t / SWITCH.in));
      default:
        return 1;
    }
  }

  // How far the camera is pushed along its view.
  get push(): number {
    if (this.still) return 0;
    switch (this.phase) {
      case 'out': {
        const u = Math.min(1, this.t / SWITCH.out);
        return SWITCH.pushOut * u * u;
      }
      case 'hold':
        return SWITCH.pushOut;
      case 'in':
        return -SWITCH.pushIn * (1 - out(Math.min(1, this.t / SWITCH.in)));
      default:
        return 0;
    }
  }

  // How much of the old picture still shows over the new one.
  get cross(): number {
    return this.phase === 'cross' ? 1 - io(Math.min(1, this.t / SWITCH.cross)) : 0;
  }

  // dark and waiting for the new scene
  get dark(): boolean {
    return this.phase === 'hold';
  }

  get busy(): boolean {
    return this.phase !== 'idle';
  }

  // Start darkening; from part-way up a fade-in, start at the same brightness.
  out(): void {
    if (this.phase === 'out' || this.phase === 'hold') return;
    const from = this.fade;
    this.still = false;
    this.phase = 'out';
    // the time into the fade-out at which it is as bright as now
    let t = 0;
    while (t < SWITCH.out && 1 - io(t / SWITCH.out) > from) t += 0.005;
    this.t = t;
  }

  in(push = true): void {
    this.still = !push;
    this.phase = 'in';
    this.t = 0;
  }

  crossfade(): void {
    this.still = false;
    this.phase = 'cross';
    this.t = 0;
  }

  step(dt: number): void {
    if (this.phase === 'idle' || this.phase === 'hold') return;
    this.t += dt;
    if (this.phase === 'out' && this.t >= SWITCH.out) this.phase = 'hold';
    else if (this.phase === 'in' && this.t >= SWITCH.in) this.finish();
    else if (this.phase === 'cross' && this.t >= SWITCH.cross) this.finish();
  }

  finish(): void {
    this.phase = 'idle';
    this.t = 0;
    this.still = false;
  }
}
