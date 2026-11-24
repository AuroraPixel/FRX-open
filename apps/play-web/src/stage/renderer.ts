import * as THREE from 'three';
import type { Quality } from './types';

export function hasWebGL2(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

// A WebGL2 renderer on the canvas. Output stays linear: the stage's last pass does its own gamma, and three 0.149's
// legacy colour management leaves textures and colours untouched.
export function makeRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const context = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!context) throw new Error('stage: no WebGL2');
  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: false, alpha: false });
  renderer.outputEncoding = THREE.LinearEncoding;
  return renderer;
}

// Resolution policy (界面规范第九节「性能上的规矩」): pixel ratio capped at 1.6 on desktops and 1.25 on phones; a frame
// longer than 34 ms counts one, a short one takes one back; at 50 the render scale drops by 0.82, at most four
// times and never below 0.6. The deterministic mode renders at the device's ratio up to 2 and never drops. The
// settings' quality moves the cap: high allows 2 (1.6 on phones) and never drops, low caps at 1 (0.85 on phones).
export class Resolution {
  ratio: number;
  drops = 0;
  private slow = 0;
  private readonly fixed: boolean;

  constructor(deviceRatio: number, phone: boolean, fixed: boolean, quality: Quality = 'auto') {
    this.fixed = fixed || quality === 'high';
    const cap = fixed ? 2 : quality === 'high' ? (phone ? 1.6 : 2) : quality === 'low' ? (phone ? 0.85 : 1) : phone ? 1.25 : 1.6;
    this.ratio = Math.min(deviceRatio || 1, cap);
  }

  // Returns true when the ratio changed and the targets must be remade.
  frame(seconds: number): boolean {
    if (this.fixed) return false;
    if (seconds > 0.034 && seconds < 0.5) this.slow++;
    else this.slow = Math.max(0, this.slow - 1);
    if (this.slow > 50 && this.drops < 4 && this.ratio > 0.6) {
      this.ratio = Math.max(0.6, this.ratio * 0.82);
      this.drops++;
      this.slow = 0;
      return true;
    }
    return false;
  }
}
