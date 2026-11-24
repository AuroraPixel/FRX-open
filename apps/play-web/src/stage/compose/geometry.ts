/* Camera geometry for laying painted cards out (the TypeScript twin of tools/scene-kit/geometry.py).

   The stage's cameras are [x, y, z, tx, ty, tz, fov]: position, look-at point and vertical field of view. The wide set
   is used down to a width-to-height ratio of 0.82, the tall set below it. Screen positions here are fractions of the
   view: x from the left edge, y from the top edge. */

export type Vec3 = [number, number, number];
export type Cam = [number, number, number, number, number, number, number];
export type Side = 'wide' | 'tall';
export type Rig = Record<string, { wide: Cam; tall: Cam }>;

// the usual desktop and the usual phone
export const WIDE = 16 / 9;
export const TALL = 390 / 844;
// what each set must still cover: a square window, the usual desktop and an ultra-wide one; tall phones to the edge of
// the tall set
export const WIDE_ASPECTS = [1.0, WIDE, 2.2] as const;
export const TALL_ASPECTS = [0.42, TALL, 0.8] as const;
// the camera wanders this far at most (sway plus the pointer), in world units across and up
export const SWAY: [number, number] = [1.1, 0.6];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const n = Math.sqrt(dot(a, a)) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

// forward, right and up
export function basis(cam: Cam): [Vec3, Vec3, Vec3] {
  const f = norm(sub([cam[3], cam[4], cam[5]], [cam[0], cam[1], cam[2]]));
  const r = norm(cross(f, [0, 1, 0]));
  return [f, r, cross(r, f)];
}

// The screen position of a world point (fractions from the left and the top), or null behind the camera.
export function screenOf(cam: Cam, aspect: number, point: Vec3): [number, number] | null {
  const [f, r, u] = basis(cam);
  const d = sub(point, [cam[0], cam[1], cam[2]]);
  const z = dot(d, f);
  if (z <= 1e-6) return null;
  const k = Math.tan((cam[6] * Math.PI) / 360);
  return [(dot(d, r) / (z * k * aspect) + 1) / 2, (1 - dot(d, u) / (z * k)) / 2];
}

// The direction of the ray through a screen point (fractions from the left and the top).
export function ray(cam: Cam, aspect: number, sx: number, sy: number): Vec3 {
  const [f, r, u] = basis(cam);
  const k = Math.tan((cam[6] * Math.PI) / 360);
  const x = (sx * 2 - 1) * k * aspect;
  const y = (1 - sy * 2) * k;
  return norm([f[0] + r[0] * x + u[0] * y, f[1] + r[1] * x + u[1] * y, f[2] + r[2] * x + u[2] * y]);
}

// Where a ray from `origin` meets the plane at world z (the scenes face -z), or null.
export function planeHit(origin: Vec3, dir: Vec3, z: number): Vec3 | null {
  if (Math.abs(dir[2]) < 1e-9) return null;
  const s = (z - origin[2]) / dir[2];
  if (s <= 0) return null;
  return [origin[0] + dir[0] * s, origin[1] + dir[1] * s, origin[2] + dir[2] * s];
}

// The point of the plane at world z seen at a screen point under one camera.
export function worldAt(cam: Cam, aspect: number, sx: number, sy: number, z: number): Vec3 {
  const hit = planeHit([cam[0], cam[1], cam[2]], ray(cam, aspect, sx, sy), z);
  if (!hit) throw new Error(`compose: the plane z=${z} is not in front of the camera`);
  return hit;
}

export interface Extent {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

// The part of the plane at world z that any of the cameras can show (every preset, or the ones named; both sets, every
// aspect each set serves, with the sway as a margin).
export function seenOnPlane(rig: Rig, z: number, margin: [number, number] = SWAY, presets?: readonly string[]): Extent {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [name, pair] of Object.entries(rig)) {
    if (presets && !presets.includes(name)) continue;
    for (const side of ['wide', 'tall'] as const) {
      const cam = pair[side];
      for (const aspect of side === 'wide' ? WIDE_ASPECTS : TALL_ASPECTS) {
        for (const sx of [0, 0.5, 1]) {
          for (const sy of [0, 0.5, 1]) {
            for (const dx of [-margin[0], margin[0]]) {
              for (const dy of [-margin[1], margin[1]]) {
                const hit = planeHit([cam[0] + dx, cam[1] + dy, cam[2]], ray(cam, aspect, sx, sy), z);
                if (!hit) continue;
                x0 = Math.min(x0, hit[0]);
                x1 = Math.max(x1, hit[0]);
                y0 = Math.min(y0, hit[1]);
                y1 = Math.max(y1, hit[1]);
              }
            }
          }
        }
      }
    }
  }
  return { x0, x1, y0, y1 };
}

// A card's corners on screen under one camera: [left, top, right, bottom] as fractions, or null if any is behind.
export interface CardBox {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
}
export function screenBox(cam: Cam, aspect: number, card: CardBox): [number, number, number, number] | null {
  const a = screenOf(cam, aspect, [card.x - card.w / 2, card.y + card.h, card.z]);
  const b = screenOf(cam, aspect, [card.x + card.w / 2, card.y, card.z]);
  if (!a || !b) return null;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

export type Rect = [number, number, number, number];
export function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
}
