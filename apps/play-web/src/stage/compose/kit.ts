/* A family's kit (assets/scenes/kit-<family>/kit.json, written by tools/scene-kit/build_kits.py): the painted elements
   the composer lays out per place, and the parts of the scene file every place of the family shares.

   Sizes are world units (the protagonist stands 3.1 tall); fractions of a picture are measured from its left and top
   edges, on the cleaned picture. */
import type { PlaceLook, SceneFile } from '../../contracts';
import type { Rig } from './geometry';

// far: a silhouette band across the view; bank: the cloud strip laid out in rows over the cloud sea; sea: the sea band
// far out; front: a building in the street; gate: a sect's gate (the scene's subject); subject: a coast's thing that
// carries the name (an archway on the pier, a sea rock), a room's plaque hung high on its back wall; backdrop: a far
// building behind a gate; isle: an island or a stack out on the water; boat: a boat on the water; ground: the street's
// surface, the steps or terrace a gate stands on, the reef, pier or beach the protagonist stands on at the coast; prop:
// something standing in the street, beside a gate, on the shore or on a room's floor; near: a big thing close to the
// camera that frames the picture (a tree, a pole, rocks, a room's column).
// Rooms: wall: the back wall with its floor, a panorama; unit: furniture standing against the back wall (a cabinet,
// shelves, a doorway, a dais); furniture: the room's main piece on the floor (a counter, a stone table and its
// cushion); hang: something hanging from above near the camera (a lantern, a valance, stalactites).
// The wild: band: the terrain across the view behind the subject, nearer than the far range (terraced herb beds, the
// edge of a forest, a river, a marsh); side: a wall of rock that closes the view in at one side (a canyon's).
export type Role =
  | 'far' | 'bank' | 'sea' | 'front' | 'gate' | 'subject' | 'backdrop' | 'isle' | 'boat' | 'ground' | 'prop' | 'near'
  | 'wall' | 'unit' | 'furniture' | 'hang' | 'band' | 'side';

export interface Plaque {
  // the blank field the name goes in: [left, top, right, bottom] as fractions of the picture
  box: [number, number, number, number];
  // gold leaf on dark lacquer, or dark ink cut into pale stone
  ink: 'gold' | 'dark';
  // read top to bottom (a narrow upright plaque)
  vertical?: boolean;
}

export interface KitElement {
  id: string;
  file: string;
  role: Role;
  // the cleaned picture's size in pixels, its full and half-size files in bytes, and the first eight hex digits of
  // their digest (the picture is asked for with it, so a browser may keep it: the server marks it so)
  px: [number, number];
  bytes: [number, number];
  v?: string;
  // the height of the whole picture in the world at scale 1; a ground piece may also be stretched across (`stretch`)
  height: number;
  stretch?: number;
  // where it stands: the fraction of its height (from the top) that meets the ground. Far bands: `top` and `foot` are
  // the rows of the silhouette's top and of the band's base, `feature` the fraction of the width of its main feature.
  // A ground piece: `top` is the line a front or a gate stands on.
  foot: number;
  top?: number;
  feature?: number;
  plaque?: Plaque;
  // a gate painted with its own steps and guardians needs no ground piece and no guardian pair
  whole?: boolean;
  // may be shown mirrored (default yes; never one that carries the name)
  mirror?: boolean;
  // how often it is picked, the place words that make it likelier and those that rule it nearly out (see placeTags);
  // `need`: words of which the place must have one for it to be picked at all (an ice wall, icicles)
  weight?: number;
  tags?: string[];
  avoid?: string[];
  need?: string[];
  // props: set as a mirrored pair either side of a gate; where a prop may stand
  pair?: boolean;
  depths?: ('mid' | 'near')[];
  // a near prop: the point of the picture (fractions) set at the frame's edge, the trunk of a tree
  hold?: [number, number];
  // a front that only ever stands as the scene's subject (an archway, a city gate); a low rock that only ever carries
  // the name where a phone shows it
  only?: 'hero' | 'name';
  // an archway: the street is seen through its openings, so a stretch of it is laid out behind
  opening?: boolean;
  // a coast's subject that stands in the sea rather than on the shore
  water?: boolean;
  // a front's lowest eave, or the top of its ground floor where it has no lower roof (fraction from the top): the row's
  // fronts are sized so these line up
  eave?: number;
  // which cells of a 12 x 12 grid over the picture are painted: twelve rows from the top, three hex digits each,
  // the leftmost cell the highest bit (tools/scene-kit/kit_masks.mjs)
  mask?: string;
  // a front's or a gate's walls and plinth at its foot, [left, right] as fractions of the width: neighbours meet there
  body?: [number, number];
  // a front's or a gate's highest painted row, as a fraction of its height from the top
  crown?: number;
  // how much of its painted brightness the stage shows, for a picture painted lighter than the room it stands in
  // (white jade, white marble would glow in a hall lit by a few lamps)
  tone?: number;
  // a room's back wall: the width of one copy in the world (its height follows the picture); what nothing may stand
  // or hang in front of (a window, a lamp, a niche, a doorway painted in), [left, right, top, bottom] as fractions of
  // the picture (top and bottom default to its whole height); the windows the moonlight comes through, [x, y] as
  // fractions, which the stage draws shafts from; how far its top goes into shadow
  width?: number;
  keep?: ([number, number] | [number, number, number, number])[];
  lights?: [number, number][];
  shade?: number;
  // furniture that may not stand against this wall (a hanging scroll against a lattice, a doorway through it)
  refuse?: string[];
  // a thing someone made (jars, a censer): not in a natural hollow (a cave, a crevice, the bottom of a well); a
  // building of the wild (a pavilion, a hut): not the subject of a place left wild while a grown or rocky one fits
  made?: boolean;
}

export const MASK = 12;

// The painted cells of a picture as [column, row] pairs (the whole grid when it has no mask), mirrored if asked.
export function paintedCells(el: KitElement, flip = false): [number, number][] {
  const cells: [number, number][] = [];
  for (let row = 0; row < MASK; row++) {
    const bits = el.mask ? parseInt(el.mask.slice(row * 3, row * 3 + 3), 16) : (1 << MASK) - 1;
    for (let col = 0; col < MASK; col++) {
      if (bits & (1 << (MASK - 1 - col))) cells.push([flip ? MASK - 1 - col : col, row]);
    }
  }
  return cells;
}

export type Layout = 'street' | 'gate' | 'coast' | 'room' | 'wild';

// How a family's rooms are laid out (a room kit): the depth of the back wall, where the main piece on the floor
// stands (z range, and the screen x range of its centre in the reading view), whether the main piece is the one the
// protagonist sits at (a cave's stone table and cushion stand just behind it), and the heights of the reading view
// the plaque's middle is tried at, the first that fits.
export interface RoomPlan {
  wallZ: number;
  furniture: { z: [number, number]; at: [number, number] };
  seat?: boolean;
  plaque?: number[];
}

export interface KitFile {
  id: string;
  family: string;
  name: string;
  layout: Layout;
  // the height of the ground the protagonist stands on, and where the stage's mist floor lies under it
  ground: number;
  // the parts of the family's scene file every place shares (cameras, anchors, sky, weather, sound, floor, pose, and a
  // room's hours)
  base: Pick<SceneFile, 'kind' | 'indoor' | 'eye' | 'sky' | 'cameras' | 'anchors' | 'weather' | 'ambience' | 'mood' | 'floor' | 'protagonist'>
    & Partial<Pick<SceneFile, 'hours'>>;
  bankRows?: [number, number, number][];
  // a coast: the height of the sea's surface, where what stands in the water sinks into its mist
  sea?: number;
  room?: RoomPlan;
  // the sound of a terrain unlike the base's (the wild's ruins: the wind and the tense music of the ruins' painting; a
  // canyon: a peak's wind), by the look's terrain
  sounds?: Partial<Record<string, Pick<SceneFile, 'ambience' | 'mood'>>>;
  // 'house': for a spot of another family the server names the subject after the building the spot is before or in
  // the yard of (a courtyard's hall: 杂务堂外 → 杂务堂), not after the map place (frx.play_art.kit_names)
  names?: 'house';
  // ground fire glowing up through the mist floor (the abyss's): at depth `z` before the protagonist's place, `over`
  // the mist floor's height, lighting `radius` about it
  fire?: { z: number; radius: number; over: number };
  elements: KitElement[];
}

// What the composer is told about a place: the map's name and region, its kind if the caller knows one (the scene
// type of the place itself: a room takes after it), and its description (words in it can tip a choice: a lake, a
// wall, a market).
export interface Place {
  id: string;
  name: string;
  region?: string;
  kind?: string;
  description?: string;
  // what the place looks like (contracts PlaceLook): its setting, terrain, structure, features, scale and mood are
  // tags of the place, so the pieces that fit it are picked
  look?: PlaceLook;
}

export const rigOf = (kit: KitFile): Rig => kit.base.cameras as unknown as Rig;

export function aspect(el: KitElement): number {
  return el.px[0] / el.px[1];
}

export async function loadKit(url: string): Promise<KitFile> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`compose: ${url} ${response.status}`);
  return (await response.json()) as KitFile;
}
