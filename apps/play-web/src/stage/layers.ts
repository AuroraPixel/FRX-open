import * as THREE from 'three';
import type { Shared } from './env';
import type { ArcPiece, CardPiece, Paint, Piece } from './scene-loader';
import { DEPTH_FS, PAINT_FS, PAINT_VS } from './shaders/paint.glsl';
import type { Textures } from './textures';
import type { PlaqueSpec } from './types';

// The stage's last things in the scene buffer, after every painting and every effect: the depth of the solid parts
// of the nearer paintings and of the protagonist, then the embers and the rain and snow, which test against it.
export const DEPTH_ORDER = 6.9;
export const EMBER_ORDER = 6.95;
export const WEATHER_ORDER = 7;

export interface TwinUniforms {
  tMap: THREE.IUniform;
  uUv: THREE.IUniform;
  uFade: THREE.IUniform;
  uSink: THREE.IUniform;
  uEdge: THREE.IUniform;
}

// A depth-only copy of a painting, a child of its mesh (so it turns and drifts with it), sharing its picture and
// fades (the uniforms are the painting's own objects): it writes the depth of whatever is at least half opaque and
// draws no colour.
export function depthTwin(geometry: THREE.BufferGeometry, uniforms: TwinUniforms): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    colorWrite: false,
    depthWrite: true,
    side: THREE.DoubleSide,
    uniforms: { ...uniforms },
    vertexShader: PAINT_VS,
    fragmentShader: DEPTH_FS,
  });
  const twin = new THREE.Mesh(geometry, material);
  twin.renderOrder = DEPTH_ORDER;
  twin.frustumCulled = false;
  return twin;
}

// The painted layers. They are premultiplied and write no depth, so the draw order is everything: see assignOrders.
// The pieces drawn in their own order (the middle distance and the near cut-outs) also have a depth twin.
export function paintMaterial(
  texture: THREE.Texture,
  paint: Paint,
  flip: boolean,
  side: THREE.Side,
  shared: Shared,
): THREE.ShaderMaterial {
  const sink = paint.sink ?? [-1000, -999];
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      ...shared,
      tMap: { value: texture },
      uUv: { value: new THREE.Vector4(flip ? 1 : 0, 0, flip ? 0 : 1, 1) },
      uGain: { value: paint.gain },
      uHaze: { value: paint.haze },
      uMist: { value: paint.mist },
      uMistY: { value: new THREE.Vector2(paint.mistLo, paint.mistHi) },
      uMistGain: { value: paint.mistGain },
      uMistHaze: { value: paint.mistHaze },
      uAuraK: { value: paint.aura },
      uTintN: { value: new THREE.Color(...paint.tintNight) },
      uTintRatio: { value: new THREE.Color(...paint.tintRatio) },
      uSatOff: { value: paint.satOffset },
      uFade: { value: 1 },
      uSink: { value: new THREE.Vector2(sink[0], sink[1]) },
      uEdge: { value: paint.edge },
    },
    vertexShader: PAINT_VS,
    fragmentShader: PAINT_FS,
  });
}

interface Drifting {
  mesh: THREE.Mesh;
  x: number;
  amp: number;
  phase: number;
}

// Arcs (bent round the eye, seen from inside), cards (standing on their foot, some turning to the camera) and the
// bank's rows, which arrive here already laid out as cards.
export class Layers {
  readonly group = new THREE.Group();
  private readonly facing: THREE.Mesh[] = [];
  private readonly drifting: Drifting[] = [];
  private readonly cardGeometry = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  private readonly geometries: THREE.BufferGeometry[] = [this.cardGeometry];
  private readonly materials: THREE.Material[] = [];

  private readonly written: Readonly<Record<string, PlaqueSpec>>;

  // `written`: the plaques the place's name is written on, by the file of their layer
  constructor(
    pieces: Piece[], folder: string, textures: Textures, shared: Shared, eye: [number, number],
    written: Readonly<Record<string, PlaqueSpec>> = {},
  ) {
    this.written = written;
    for (const piece of pieces) {
      const mesh = piece.kind === 'arc' ? this.arc(piece, folder, textures, shared, eye) : this.card(piece, folder, textures, shared);
      mesh.renderOrder = piece.renderOrder;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
  }

  private picture(file: string, folder: string, textures: Textures): THREE.Texture {
    const plaque = this.written[file];
    return plaque ? textures.written(folder + file, plaque) : textures.get(folder + file);
  }

  private arc(piece: ArcPiece, folder: string, textures: Textures, shared: Shared, eye: [number, number]): THREE.Mesh {
    const span = (piece.span * Math.PI) / 180;
    const start = Math.PI - ((piece.azimuth * Math.PI) / 180 + span / 2);
    const geometry = new THREE.CylinderGeometry(piece.radius, piece.radius, piece.height, 72, 1, true, start, span);
    geometry.translate(0, piece.height / 2, 0);
    this.geometries.push(geometry);
    // seen from inside, so the picture is mirrored unless the layer asks for that
    const material = paintMaterial(this.picture(piece.file, folder, textures), piece.paint, !piece.flip, THREE.BackSide, shared);
    this.materials.push(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(eye[0], piece.y, eye[1]);
    return mesh;
  }

  private card(piece: CardPiece, folder: string, textures: Textures, shared: Shared): THREE.Mesh {
    const material = paintMaterial(this.picture(piece.file, folder, textures), piece.paint, piece.flip, THREE.DoubleSide, shared);
    this.materials.push(material);
    const mesh = new THREE.Mesh(this.cardGeometry, material);
    mesh.scale.set(piece.w, piece.h, 1);
    mesh.position.set(piece.x, piece.y, piece.z);
    if (piece.paint.order >= 0) {
      const u = material.uniforms;
      const twin = depthTwin(this.cardGeometry, { tMap: u.tMap!, uUv: u.uUv!, uFade: u.uFade!, uSink: u.uSink!, uEdge: u.uEdge! });
      this.materials.push(twin.material as THREE.Material);
      mesh.add(twin);
    }
    if (piece.face) this.facing.push(mesh);
    if (piece.drift) this.drifting.push({ mesh, x: piece.x, amp: piece.drift, phase: piece.z * 0.37 });
    return mesh;
  }

  // Cut-outs turn most of the way to the camera (not all: they would look like paper); clouds drift.
  update(camera: THREE.Camera, time: number): void {
    for (const mesh of this.facing) {
      mesh.rotation.y = Math.atan2(camera.position.x - mesh.position.x, camera.position.z - mesh.position.z) * 0.85;
    }
    for (const d of this.drifting) d.mesh.position.x = d.x + Math.sin(time * 0.05 + d.phase) * d.amp;
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
