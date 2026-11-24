import type { ArcLayer, BankLayer, CardLayer, SceneFile, SkyManifest } from '../contracts';
import { hourLook, type HourLook, type Rgb } from './hours';
import { FOCUS_PRESETS, HOUR_NAMES, type FocusPreset, type Hour, type PlaqueSpec, type Pose, type SceneSpec, type Weather } from './types';

export type Vec3 = [number, number, number];
export type Cam = [number, number, number, number, number, number, number];

// A layer's colour and fog, with every default filled in.
export interface Paint {
  order: number;
  gain: number;
  haze: number;
  mist: number;
  mistLo: number;
  mistHi: number;
  mistGain: number;
  mistHaze: number;
  sink: [number, number] | null;
  edge: number;
  aura: number;
  tintNight: Rgb;
  // the layer's lean off the lit hours' tint and saturation, measured at dawn where it was tuned
  tintRatio: Rgb;
  satOffset: number;
}

export interface ArcPiece {
  kind: 'arc';
  file: string;
  radius: number;
  span: number;
  azimuth: number;
  height: number;
  y: number;
  flip: boolean;
  z: number;
  paint: Paint;
  renderOrder: number;
}

export interface CardPiece {
  kind: 'card';
  file: string;
  w: number;
  h: number;
  x: number;
  y: number;
  z: number;
  face: boolean;
  flip: boolean;
  drift: number;
  paint: Paint;
  renderOrder: number;
}

export type Piece = ArcPiece | CardPiece;

// What lies at the floor height: the stage's sea of cloud, a ground haze (towns, gardens, the coast's sea mist), or
// nothing (rooms). The tint multiplies its colour at every hour; strength is how thick it lies.
export type FloorKind = 'clouds' | 'haze';
export interface FloorDesc {
  kind: FloorKind;
  y: number;
  tint: Rgb;
  strength: number;
}

export interface ShaftDesc {
  from: Vec3;
  to: Vec3;
  width: number;
  strength: number;
}

export interface FireDesc {
  at: Vec3;
  radius: number;
  strength: number;
}

export interface RunesDesc {
  at: Vec3;
  radius: number;
  squash: number;
  strength: number;
}

export interface SceneDesc {
  id: string;
  name: string;
  indoor: boolean;
  // URLs of the scene's folder and of its sky set's folder, already pointing at half/ on narrow screens
  folder: string;
  skyFolder: string;
  key: string;
  eye: [number, number];
  cloudFloor: number | null;
  sky: { azimuth: number; horizon: number; files: SkyManifest };
  pieces: Piece[];
  cameras: Record<FocusPreset, { wide: Cam; tall: Cam }>;
  anchors: { player: Vec3; aura: Vec3; foe: Vec3 | null };
  looks: Record<Hour, HourLook>;
  weather: Weather[];
  floor: FloorDesc | null;
  // whether the formation may appear here (it shows only while cultivating or breaking through)
  formation: boolean;
  // the protagonist's pose when the page does not ask for one, its size against the usual one, and where it falls
  // in the draw order: after every near piece standing behind it
  hero: { pose: Pose; scale: number; order: number };
  effects: { shafts: ShaftDesc[]; fire: FireDesc[]; runes: RunesDesc[] };
  // the plaques the place's name is written on, by the file of the layer that carries each (a scene composed on the
  // page; none in a scene file)
  written: Readonly<Record<string, PlaqueSpec>>;
}

// Layers without an order sit in the middle distance: after the far arcs and the stage's own translucent clouds,
// before the near cut-outs. Layers with the same order are drawn far to near along world z (scenes look towards -z).
export const DEFAULT_ORDER = -8.5;
const ORDER_STEP = 1e-4;

// The bank of cloud strips: the first rows stand at full height; further rows are flattened, as distant cloud tops
// seen at a grazing angle really are. The rows are centred along a line from the eye leaning 2.1 degrees right of
// the way the sky faces, alternate mirrored and shifted so the same clouds never line up, each drifts a little, and
// each dissolves into the cloud floor from a height set by its own top. The near rows are a touch darker and take
// more of the sky's haze. All of this is how the trial was tuned; the bank's rows only give z, top and width.
const BANK_HEADING = 2.1;
const BANK_NEAR_ROWS = 3;
const BANK_NEAR_GAIN = 0.9;
const BANK_NEAR_HAZE = 0.3;
const BANK_FLATTEN = 2.3;

const num = (value: unknown, name: string): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`scene: ${name} is not a number`);
  return n;
};
const vec = <T extends number[]>(value: unknown[] | undefined, size: number, name: string): T => {
  if (!value || value.length !== size) throw new Error(`scene: ${name} needs ${size} numbers`);
  return value.map((v, i) => num(v, `${name}[${i}]`)) as T;
};

type AnyLayer = ArcLayer | CardLayer | BankLayer;

export function resolvePaint(layer: AnyLayer, dawn: HourLook): Paint {
  const tintDay = layer.tintDay ? vec<Rgb>(layer.tintDay, 3, 'tintDay') : null;
  return {
    order: layer.order ?? DEFAULT_ORDER,
    gain: layer.gain ?? 0.5,
    haze: layer.haze ?? 0.9,
    mist: layer.mist ?? 0.9,
    mistLo: layer.mistLo ?? -0.4,
    mistHi: layer.mistHi ?? 2.8,
    mistGain: layer.mistGain ?? 1,
    mistHaze: layer.mistHaze ?? 0,
    sink: layer.sink ? vec<[number, number]>(layer.sink, 2, 'sink') : null,
    edge: layer.edge ?? 0.0001,
    aura: layer.aura ?? 0,
    tintNight: layer.tintNight ? vec<Rgb>(layer.tintNight, 3, 'tintNight') : [1, 1, 1],
    tintRatio: tintDay ? [tintDay[0] / dawn.tint[0], tintDay[1] / dawn.tint[1], tintDay[2] / dawn.tint[2]] : [1, 1, 1],
    satOffset: layer.satDay !== undefined ? layer.satDay - dawn.sat : 0,
  };
}

export function expandBank(
  layer: BankLayer,
  paint: Paint,
  eye: [number, number],
  azimuth: number,
  cloudFloor: number,
): CardPiece[] {
  const aspect = num(layer.aspect, 'bank aspect');
  const slant = Math.tan(((azimuth + BANK_HEADING) * Math.PI) / 180);
  return layer.rows.map((row, n) => {
    const [z, top, w] = vec<Vec3>(row, 3, `bank row ${n}`);
    const near = n < BANK_NEAR_ROWS;
    const h = near ? w / aspect : Math.min(w / aspect, top * BANK_FLATTEN);
    const y = near ? top - h * 0.84 : top * 0.3 - h * 0.63;
    const x = eye[0] + (eye[1] - z) * slant + (n % 2 ? 0.13 : -0.11) * w;
    const rowPaint: Paint = {
      ...paint,
      gain: near ? paint.gain * BANK_NEAR_GAIN : paint.gain,
      haze: near ? Math.min(1, paint.haze + BANK_NEAR_HAZE) : paint.haze,
      sink: [cloudFloor + top * 0.02, cloudFloor + top * (near ? 0.5 : 0.22)],
    };
    return {
      kind: 'card', file: layer.file, w, h, x, y: cloudFloor + y, z, face: false, flip: n % 2 === 1, drift: w * 0.01,
      paint: rowPaint, renderOrder: 0,
    };
  });
}

// Order every piece: by `order`, then far to near, then as written.
export function assignOrders(pieces: Piece[]): void {
  const ranked = pieces.map((piece, index) => ({ piece, index }));
  ranked.sort((a, b) => a.piece.paint.order - b.piece.paint.order || a.piece.z - b.piece.z || a.index - b.index);
  let group = Number.NaN;
  let rank = 0;
  for (const { piece } of ranked) {
    if (piece.paint.order !== group) {
      group = piece.paint.order;
      rank = 0;
    }
    piece.renderOrder = group + rank * ORDER_STEP;
    rank++;
  }
}

// The protagonist stands among the near pieces: drawn after every piece with an explicit order that stands no nearer
// than it (the rock it sits on, the table behind it, the sword under its feet), before the ones in front.
const HERO_ORDER_DEFAULT = 0.5;
export function heroOrder(pieces: Piece[], z: number): number {
  let order = HERO_ORDER_DEFAULT;
  for (const piece of pieces) {
    if (piece.paint.order >= 0 && piece.z <= z + 1e-6) order = Math.max(order, piece.renderOrder + ORDER_STEP / 2);
  }
  return order;
}

function floorOf(raw: SceneFile): FloorDesc | null {
  const y = raw.cloudFloor ?? null;
  const kind = raw.floor?.kind ?? (y === null ? 'none' : 'clouds');
  if (kind === 'none') return null;
  if (y === null) throw new Error(`scene: a ${kind} floor needs cloudFloor`);
  return {
    kind,
    y,
    tint: raw.floor?.tint ? vec<Rgb>(raw.floor.tint, 3, 'floor.tint') : [1, 1, 1],
    strength: raw.floor?.strength ?? 1,
  };
}

function effectsOf(raw: SceneFile): SceneDesc['effects'] {
  const e = raw.effects ?? {};
  return {
    shafts: (e.shafts ?? []).map((s, i) => ({
      from: vec<Vec3>(s.from, 3, `shafts[${i}].from`), to: vec<Vec3>(s.to, 3, `shafts[${i}].to`),
      width: num(s.width, `shafts[${i}].width`), strength: s.strength ?? 1,
    })),
    fire: (e.fire ?? []).map((f, i) => ({
      at: vec<Vec3>(f.at, 3, `fire[${i}].at`), radius: num(f.radius, `fire[${i}].radius`), strength: f.strength ?? 1,
    })),
    runes: (e.runes ?? []).map((r, i) => ({
      at: vec<Vec3>(r.at, 3, `runes[${i}].at`), radius: num(r.radius, `runes[${i}].radius`), squash: r.squash ?? 1,
      strength: r.strength ?? 1,
    })),
  };
}

// A sky set named with a slash is a folder under the art root; a bare name is a shared set under skies/.
export function skyFolder(assets: string, set: string): string {
  return set.includes('/') ? `${assets}${set.replace(/\/?$/, '/')}` : `${assets}skies/${set}/`;
}

// `folder`: where the scene's pictures are, ending in '/' (default assets/scenes/<id>/); `plaques`: the plaques of a
// scene composed on the page
export function normalizeScene(
  raw: SceneFile, sky: SkyManifest, assets: string, narrow: boolean, folder?: string, plaques: readonly PlaqueSpec[] = [],
): SceneDesc {
  const half = narrow ? 'half/' : '';
  const eye = vec<[number, number]>(raw.eye, 2, 'eye');
  const cloudFloor = raw.cloudFloor ?? null;
  const azimuth = num(raw.sky.azimuth, 'sky.azimuth');
  const looks = Object.fromEntries(HOUR_NAMES.map((h) => [h, hourLook(h, raw.hours[h])])) as Record<Hour, HourLook>;
  // A lit hour whose panorama is dawn's stands in with a regrade; an hour with its own panorama shows it as painted.
  for (const h of ['day', 'dusk'] as const) {
    if (sky[h].clear !== sky.dawn.clear) Object.assign(looks[h], { skyTint: [1, 1, 1], skySat: 1 });
  }
  const pieces: Piece[] = [];
  for (const layer of raw.layers) {
    const paint = resolvePaint(layer, looks.dawn);
    if (layer.type === 'bank') {
      pieces.push(...expandBank(layer, paint, eye, azimuth, cloudFloor ?? 0));
    } else if (layer.type === 'arc') {
      const radius = num(layer.radius, 'arc radius');
      const span = num(layer.span, 'arc span');
      pieces.push({
        kind: 'arc', file: layer.file, radius, span, azimuth: num(layer.azimuth, 'arc azimuth'),
        height: (radius * span * Math.PI) / 180 / num(layer.aspect, 'arc aspect'), y: num(layer.y, 'arc y'),
        flip: !!layer.flip, z: eye[1], paint, renderOrder: 0,
      });
    } else {
      pieces.push({
        kind: 'card', file: layer.file, w: num(layer.w, 'card w'), h: num(layer.h, 'card h'), x: num(layer.x, 'card x'),
        y: num(layer.y, 'card y'), z: num(layer.z, 'card z'), face: !!layer.face, flip: !!layer.flip,
        drift: layer.drift ?? 0, paint, renderOrder: 0,
      });
    }
  }
  assignOrders(pieces);
  const cameras = Object.fromEntries(
    FOCUS_PRESETS.map((name) => {
      const pair = raw.cameras[name];
      return [name, { wide: vec<Cam>(pair.wide, 7, `${name}.wide`), tall: vec<Cam>(pair.tall, 7, `${name}.tall`) }];
    }),
  ) as Record<FocusPreset, { wide: Cam; tall: Cam }>;
  const player = vec<Vec3>(raw.anchors.player, 3, 'anchors.player');
  return {
    id: raw.id,
    name: raw.name,
    indoor: raw.indoor,
    folder: `${folder ?? `${assets}scenes/${raw.id}/`}${half}`,
    skyFolder: `${skyFolder(assets, raw.sky.set)}${half}`,
    key: raw.key,
    eye,
    cloudFloor,
    sky: { azimuth, horizon: num(raw.sky.horizon, 'sky.horizon'), files: sky },
    pieces,
    cameras,
    anchors: {
      player,
      aura: vec<Vec3>(raw.anchors.aura, 3, 'anchors.aura'),
      foe: raw.anchors.foe ? vec<Vec3>(raw.anchors.foe, 3, 'anchors.foe') : null,
    },
    looks,
    weather: raw.weather.length ? raw.weather : ['clear'],
    floor: floorOf(raw),
    formation: raw.formation ?? true,
    hero: {
      pose: raw.protagonist?.pose ?? 'sit',
      scale: raw.protagonist?.scale ?? 1,
      order: heroOrder(pieces, player[2]),
    },
    effects: effectsOf(raw),
    written: Object.fromEntries(
      plaques.flatMap((p) => {
        const layer = raw.layers[p.layer];
        return layer ? [[layer.file, p] as const] : [];
      }),
    ),
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`stage: ${url} ${response.status}`);
  return (await response.json()) as T;
}

// A scene by id from its scene file, or one handed over whole (a place composed on the page).
export async function loadScene(assets: string, scene: string | SceneSpec, narrow: boolean): Promise<SceneDesc> {
  if (typeof scene !== 'string') {
    const sky = await fetchJson<SkyManifest>(`${skyFolder(assets, scene.file.sky.set)}sky.json`);
    return normalizeScene(scene.file, sky, assets, narrow, scene.folder, scene.plaques);
  }
  const raw = await fetchJson<SceneFile>(`${assets}scenes/${encodeURIComponent(scene)}/scene.json`);
  if (raw.id !== scene) throw new Error(`stage: scene ${scene} says it is ${raw.id}`);
  const sky = await fetchJson<SkyManifest>(`${skyFolder(assets, raw.sky.set)}sky.json`);
  return normalizeScene(raw, sky, assets, narrow);
}
