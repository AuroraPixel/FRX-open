import * as THREE from 'three';
import type { Shared } from './env';
import type { FloorDesc } from './scene-loader';
import { FLOOR_FS, FLOOR_VS } from './shaders/world.glsl';

// The stage's own floor at a scene's floor height: a sea of cloud (peaks, the gate over the clouds, the sky, the
// abyss) or a ground haze (streets, gardens, the coast's sea mist); rooms have none. One solid plane and drifting
// translucent layers above it. The drifting layers are drawn straight after the far arcs (renderOrder just above -9);
// painted cut-outs write no depth, so if they came later they would cover the near rock and leave a flat band under
// the horizon. A cloud sea's solid plane writes depth (what goes below the clouds is gone); a ground haze's does not,
// so a haze may lie at the protagonist's feet, above the foot of the painted street it fades into.
const HEIGHTS = [0, 0.55, 1.15];

export class Floor {
  readonly group = new THREE.Group();
  private readonly geometry = new THREE.PlaneGeometry(2400, 2400, 1, 1).rotateX(-Math.PI / 2);
  private readonly materials: THREE.ShaderMaterial[] = [];

  constructor(desc: FloorDesc, shared: Shared, low: boolean) {
    const count = low ? 2 : 3;
    for (let i = 0; i < count; i++) {
      const material = new THREE.ShaderMaterial({
        transparent: i > 0,
        depthWrite: i === 0 && desc.kind === 'clouds',
        uniforms: {
          ...shared,
          uLayer: { value: i },
          uKind: { value: desc.kind === 'haze' ? 1 : 0 },
          uTint: { value: new THREE.Color(...desc.tint) },
          uK: { value: desc.strength },
        },
        vertexShader: FLOOR_VS,
        fragmentShader: FLOOR_FS,
      });
      this.materials.push(material);
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.position.y = desc.y + HEIGHTS[i]!;
      mesh.renderOrder = i === 0 ? 0 : -8.95 + i * 0.03;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
  }

  dispose(): void {
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
