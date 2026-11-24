// The map's geometry, from the map view alone (GET /saves/{id}/map: regions, their areas and places
// with coordinates). The view has no outlines, so the land and each region are drawn as the shape
// their places make: every place spreads a little ink around it, and the outline is where the ink is
// thick enough (marching squares over that field). Areas are named, not outlined: their places lie
// too far apart for an outline to read as one shape. Pure functions, tested directly.
import type { MapView, Poi } from '../../contracts';

export type Point = [number, number];

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A place with the region and area it lies in. */
export interface Place extends Poi {
  regionId: string;
  regionName: string;
  areaId: string;
  areaName: string;
}

export interface Shape {
  id: string;
  name: string;
  places: Place[];
  box: Box;
  /** where its name stands */
  label: Point;
}

export interface RegionShape extends Shape {
  areas: Shape[];
  /** the outline as SVG path data, in map units */
  outline: string;
}

export interface World {
  places: Place[];
  regions: RegionShape[];
  /** every place's ink together: the coasts */
  land: string;
  box: Box;
  /** the place the player is at, when the map knows it */
  here: Place | null;
  /** the player's own position (it may lie between places) */
  hereAt: Point;
  hereRegion: string;
}

/** How far a place's ink spreads, in map units (a map unit is 10 km), and the cell of the grid. */
const INK = {
  land: { radius: 150, cell: 26, level: 0.3 },
  region: { radius: 110, cell: 22, level: 0.32 },
};

/** The scene kinds of places, as the detail names them. */
export const KIND_LABEL: Record<string, string> = {
  peak: '山岳',
  street: '街巷',
  cave: '洞府',
  gate: '宗门',
  hall: '宗门',
  town: '城镇',
  shop: '坊市',
  coast: '海岸',
  forest: '山林',
  manor: '世家',
  temple: '寺庙',
  desert: '荒漠',
  ice: '冰原',
  ruin: '遗迹',
  abyss: '深渊',
  battle: '战场',
  sky: '高空',
};

export type Terrain = 'hills' | 'waves' | 'trees' | 'dunes' | 'snow' | 'walls' | 'rift' | null;

/** The little ink sign drawn beside a place for its kind of land. */
export function terrainOf(kind: string): Terrain {
  switch (kind) {
    case 'peak':
    case 'gate':
    case 'hall':
    case 'cave':
    case 'temple':
      return 'hills';
    case 'coast':
      return 'waves';
    case 'forest':
      return 'trees';
    case 'desert':
      return 'dunes';
    case 'ice':
      return 'snow';
    case 'town':
    case 'street':
    case 'shop':
    case 'manor':
      return 'walls';
    case 'abyss':
    case 'ruin':
    case 'battle':
      return 'rift';
    default:
      return null;
  }
}

export function boxOf(points: readonly Point[], pad = 0): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  if (!Number.isFinite(x0)) return { x0: -pad, y0: -pad, x1: pad, y1: pad };
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

function centre(points: readonly Point[]): Point {
  if (!points.length) return [0, 0];
  let x = 0;
  let y = 0;
  for (const [px, py] of points) {
    x += px;
    y += py;
  }
  return [x / points.length, y / points.length];
}

/**
 * The outline of the ink the points spread: each point adds (1 − d²/r²)² within r, and the outline
 * runs where the sum reaches `level`. Closed loops, smoothed, as SVG path data rounded to a tenth.
 */
export function inkOutline(points: readonly Point[], radius: number, cell: number, level: number): string {
  if (!points.length) return '';
  const box = boxOf(points, radius + cell * 2);
  const cols = Math.ceil((box.x1 - box.x0) / cell) + 1;
  const rows = Math.ceil((box.y1 - box.y0) / cell) + 1;
  const field = new Float32Array(cols * rows);
  const r2 = radius * radius;
  for (const [px, py] of points) {
    const c0 = Math.max(0, Math.floor((px - radius - box.x0) / cell));
    const c1 = Math.min(cols - 1, Math.ceil((px + radius - box.x0) / cell));
    const r0 = Math.max(0, Math.floor((py - radius - box.y0) / cell));
    const r1 = Math.min(rows - 1, Math.ceil((py + radius - box.y0) / cell));
    for (let r = r0; r <= r1; r += 1) {
      const dy = box.y0 + r * cell - py;
      for (let c = c0; c <= c1; c += 1) {
        const dx = box.x0 + c * cell - px;
        const d2 = dx * dx + dy * dy;
        if (d2 < r2) {
          const k = 1 - d2 / r2;
          field[r * cols + c]! += k * k;
        }
      }
    }
  }
  const at = (c: number, r: number) => field[r * cols + c]!;
  // where the outline crosses an edge between two grid corners, by edge: h<c>,<r> runs right of
  // corner (c, r), v<c>,<r> runs down from it
  const crossing = new Map<string, Point>();
  const cross = (key: string, ax: number, ay: number, av: number, bx: number, by: number, bv: number): string => {
    if (!crossing.has(key)) {
      const t = av === bv ? 0.5 : (level - av) / (bv - av);
      crossing.set(key, [ax + (bx - ax) * t, ay + (by - ay) * t]);
    }
    return key;
  };
  const links = new Map<string, string[]>();
  const join = (a: string, b: string) => {
    links.set(a, [...(links.get(a) ?? []), b]);
    links.set(b, [...(links.get(b) ?? []), a]);
  };
  for (let r = 0; r < rows - 1; r += 1) {
    for (let c = 0; c < cols - 1; c += 1) {
      const tl = at(c, r);
      const tr = at(c + 1, r);
      const br = at(c + 1, r + 1);
      const bl = at(c, r + 1);
      const index = (tl >= level ? 8 : 0) | (tr >= level ? 4 : 0) | (br >= level ? 2 : 0) | (bl >= level ? 1 : 0);
      if (index === 0 || index === 15) continue;
      const x = box.x0 + c * cell;
      const y = box.y0 + r * cell;
      const top = () => cross(`h${c},${r}`, x, y, tl, x + cell, y, tr);
      const right = () => cross(`v${c + 1},${r}`, x + cell, y, tr, x + cell, y + cell, br);
      const bottom = () => cross(`h${c},${r + 1}`, x, y + cell, bl, x + cell, y + cell, br);
      const left = () => cross(`v${c},${r}`, x, y, tl, x, y + cell, bl);
      const middle = (tl + tr + br + bl) / 4 >= level;
      switch (index) {
        case 1:
        case 14:
          join(left(), bottom());
          break;
        case 2:
        case 13:
          join(bottom(), right());
          break;
        case 3:
        case 12:
          join(left(), right());
          break;
        case 4:
        case 11:
          join(top(), right());
          break;
        case 6:
        case 9:
          join(top(), bottom());
          break;
        case 7:
        case 8:
          join(left(), top());
          break;
        case 5:
          // the two inked corners are joined through the middle, or kept apart
          if (middle) {
            join(left(), top());
            join(bottom(), right());
          } else {
            join(left(), bottom());
            join(top(), right());
          }
          break;
        case 10:
          if (middle) {
            join(left(), bottom());
            join(top(), right());
          } else {
            join(left(), top());
            join(bottom(), right());
          }
          break;
        default:
          break;
      }
    }
  }
  // walk the links into loops
  const used = new Set<string>();
  const loops: Point[][] = [];
  for (const start of links.keys()) {
    if (used.has(start)) continue;
    const loop: Point[] = [];
    let previous = '';
    let current: string | undefined = start;
    while (current && !used.has(current)) {
      used.add(current);
      loop.push(crossing.get(current)!);
      const next: string | undefined = (links.get(current) ?? []).find((k) => k !== previous && !used.has(k));
      previous = current;
      current = next;
    }
    if (loop.length >= 3) loops.push(smooth(loop));
  }
  return loops.map(pathOf).join(' ');
}

/** Chaikin's corner cutting, twice: the grid's steps become soft ink lines. */
function smooth(loop: Point[], rounds = 2): Point[] {
  let points = loop;
  for (let round = 0; round < rounds; round += 1) {
    const next: Point[] = [];
    for (let i = 0; i < points.length; i += 1) {
      const [ax, ay] = points[i]!;
      const [bx, by] = points[(i + 1) % points.length]!;
      next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    points = next;
  }
  return points;
}

function pathOf(loop: Point[]): string {
  const n = (v: number) => (Math.round(v * 10) / 10).toString();
  return `M${loop.map(([x, y]) => `${n(x)} ${n(y)}`).join('L')}Z`;
}

/** The map view as shapes: regions and areas with places, their outlines, the land, where the player is. */
export function worldOf(view: MapView): World {
  const places: Place[] = [];
  const regions: RegionShape[] = [];
  for (const region of view.regions) {
    const regionPlaces: Place[] = [];
    const areas: Shape[] = [];
    for (const area of region.areas) {
      const own = area.pois.map((poi) => ({ ...poi, regionId: region.id, regionName: region.name, areaId: area.id, areaName: area.name }));
      if (!own.length) continue;
      regionPlaces.push(...own);
      const points = own.map((p): Point => [p.x, p.y]);
      areas.push({ id: area.id, name: area.name, places: own, box: boxOf(points), label: centre(points) });
    }
    if (!regionPlaces.length) continue;
    places.push(...regionPlaces);
    const points = regionPlaces.map((p): Point => [p.x, p.y]);
    regions.push({
      id: region.id,
      name: region.name,
      places: regionPlaces,
      areas,
      box: boxOf(points),
      outline: inkOutline(points, INK.region.radius, INK.region.cell, INK.region.level),
      label: centre(points),
    });
  }
  const all = places.map((p): Point => [p.x, p.y]);
  const here = places.find((p) => p.id === view.here.poiId) ?? null;
  return {
    places,
    regions,
    land: inkOutline(all, INK.land.radius, INK.land.cell, INK.land.level),
    box: boxOf(all),
    here,
    hereAt: [view.here.x, view.here.y],
    hereRegion: here?.regionId ?? view.here.regionId,
  };
}

/** Where the map is looked at from: the map point at the middle of the frame, and px per map unit. */
export interface View {
  cx: number;
  cy: number;
  scale: number;
}

/** The view that shows a box whole in a w × h frame, with `pad` px to spare on every side. */
export function fit(box: Box, w: number, h: number, pad = 28): View {
  const bw = Math.max(1, box.x1 - box.x0);
  const bh = Math.max(1, box.y1 - box.y0);
  const scale = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
  return { cx: (box.x0 + box.x1) / 2, cy: (box.y0 + box.y1) / 2, scale: Math.max(1e-4, scale) };
}

export function toScreen(view: View, w: number, h: number, [x, y]: Point): Point {
  return [(x - view.cx) * view.scale + w / 2, (y - view.cy) * view.scale + h / 2];
}

export function toMap(view: View, w: number, h: number, [sx, sy]: Point): Point {
  return [(sx - w / 2) / view.scale + view.cx, (sy - h / 2) / view.scale + view.cy];
}

/** Zooms by `factor` keeping the map point under (sx, sy) where it is. */
export function zoomAt(view: View, w: number, h: number, [sx, sy]: Point, factor: number, limits: [number, number]): View {
  const scale = Math.min(limits[1], Math.max(limits[0], view.scale * factor));
  const [mx, my] = toMap(view, w, h, [sx, sy]);
  return { cx: mx - (sx - w / 2) / scale, cy: my - (sy - h / 2) / scale, scale };
}

/** The place nearest a point of the frame, if one lies within `reach` px of it. */
export function nearest(places: readonly Place[], view: View, w: number, h: number, at: Point, reach = 22): Place | null {
  let best: Place | null = null;
  let bestD = reach * reach;
  for (const place of places) {
    const [sx, sy] = toScreen(view, w, h, [place.x, place.y]);
    const d = (sx - at[0]) ** 2 + (sy - at[1]) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = place;
    }
  }
  return best;
}

/** Places whose name holds the words, the closest matches first: whole name, then start, then anywhere. */
export function search(places: readonly Place[], words: string, limit = 8): Place[] {
  const query = words.trim();
  if (!query) return [];
  const rank = (place: Place) => (place.name === query ? 0 : place.name.startsWith(query) ? 1 : 2);
  return places
    .filter((place) => place.name.includes(query) || place.areaName === query)
    .sort((a, b) => rank(a) - rank(b) || a.name.length - b.name.length)
    .slice(0, limit);
}

export type Direction = 'up' | 'down' | 'left' | 'right';

/**
 * The place the arrow keys move to: the nearest one lying in that direction (within 60° of it),
 * distance along the direction weighing less than distance across it.
 */
export function stepFrom(places: readonly Place[], from: Place, direction: Direction): Place | null {
  const [ux, uy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction] as Point;
  let best: Place | null = null;
  let bestCost = Infinity;
  for (const place of places) {
    if (place.id === from.id) continue;
    const dx = place.x - from.x;
    const dy = place.y - from.y;
    const along = dx * ux + dy * uy;
    const across = Math.abs(dx * uy - dy * ux);
    if (along <= 0 || across > along * Math.tan(Math.PI / 3)) continue;
    const cost = along + across * 2;
    if (cost < bestCost) {
      bestCost = cost;
      best = place;
    }
  }
  return best;
}

/** 「1,240」: kilometres with a thousands comma. */
export function kilometres(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}
