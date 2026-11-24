/* The composer: a place's scene laid out from its family's kit of painted elements (docs/play-contracts.md 五).

   compose(kit, place, { seed }) returns the scene file the stage already loads (contracts SceneFile: the same layers,
   cameras, anchors, hours, weather and floor), so the stage shows it with its hours, weather and changes unchanged,
   and the plaques the place's name is to be written on (the stage writes them, plaque.ts). The same place always
   gets the same scene: every choice comes from a random source seeded with the kit and the place's id (or the seed
   given). The page hands the result to the stage whole: stage.setScene({ file, folder, plaques }).

   A place may come with its look (contracts PlaceLook: setting, terrain, structure, features, scale, mood; the server
   gives it, content/art/places.json): its values are words of the place (placeTags), and a kit laid out by the look
   (the wild, the humble rooms) picks by them what stands where: pieces that need words the place lacks are left out,
   and so is what the look rules out (a temple's bell in a bandits' hall). The look's mood sets the music where it says
   one (mood.ts), and a terrain the kit has a sound for its ambience (the wild's ruins and canyons: the wind).

   The rules, per family layout:
   - Depth slots. A street: far bands at z -64 (and sometimes a second, hazier one at -96), the street's surface at
     -33, a row of fronts at -29 to -31, street props at -26 to -21, one or two big things at the frame's left edge
     at 2.5 to 4.6. A gate: a far range at -220 over the cloud bank, buildings rising from the cloud sea at -80 to -52,
     the gate at about -9 on its steps or terrace, guardians and props on its landing just in front, a big thing at
     the frame's left edge. A coast: the sea band at -260 with a range on its horizon at -185, an island or a stack
     on the water at -70 to -130, boats at -26 to -60, the reef, pier or beach the protagonist stands on at -1.5, the
     subject at -15 to -36, rocks or a pine at the frame's left edge. A room (店铺, 大殿, 洞府): the room's darkness at
     -60, its back wall at the room scene's depth (-11, -12, -8) with the plaque just before it and the furniture
     against it, the main piece on the floor at -2.5 to -5.5 (a cave's stone table just behind the protagonist, who
     sits at it), the name's low carrier at -2.6 to -7, a column or jars at the frame's left edge, a lantern or a
     valance hanging at the top. The wild: a far range at -200, the band of the terrain at -44 (for ruins, a row of
     ruined columns or floating rocks), the ground the protagonist stands on at -1.5, showing down to the frame's foot
     (the haze floor 6.5 under it), the subject at -14 to -28, a canyon's walls at -5 to -8 and -13 to -18, the place's
     things at -5 to -13, what grows at the frame's left edge.
   - The subject. A street's subject is a front whose plaque hangs high enough to read over the protagonist's head
     (the camera stands low): two archways, a capital's gate, the drum tower, an ancestral hall's gate tower or the
     opera stage. The ones that fit the place's words best come first (a capital's gate for a capital, the drum tower
     for a city, the stone archway for a village, the ancestral hall for a clan; Builder.subjects), and the first that
     finds a place is set so its plaque stands right of the reading column, left of the portrait, clear of the
     protagonist in the reading and idle views, with its roof inside the idle view. The other fronts fill the row out
     to both ends of the view wall to wall, overlapping a little, the nearer one hiding the seam, never the same front
     twice side by side, each sized so its lower eave runs at the street's eave height (low enough that the subject
     stands above the row); through an archway a stretch of the street goes on behind. A gate's subject is the gate
     itself, where the gate scene sets its own, moved right if its name would fall under the reading column, a little
     smaller if its roof would leave the idle view. A coast's subject is an archway on the pier (a port) or a
     watchtower on the shore rocks (an island), placed as a street's.
     A room's subject is the plaque hung high on its back wall (right of the reading column, left of the portrait,
     inside the idle view), over the furniture that stands under it (a hall's dais); the wall is moved along until the
     plaque and the furniture stand clear of what is painted into it (windows, lamps, niches, a round door) and of the
     posts where its mirrored copies meet, which stay near the frame's edges. Words of the place pick the wall, the
     furniture and the main piece, and so does the kind of place the room is in (a shop on the coast, a temple's hall,
     a cave in the ice); what needs a kind of place (an ice wall, a bronze image of the Buddha) is only there. A
     look's room has the wall and the furniture of its kind (a hut's, a dormitory's bunks, a study's books, an
     alchemy room's furnace, a cell's bars, a bandits' hall with its tiger-skin seat); a natural hollow (no structure)
     has nothing anyone made. The wild's subject is one that fits the terrain (a field's thatched hut, a pavilion by a
     forest path or a river, a cliff face with a carved field, a waterfall, a stockade, a ruined gate, obelisk or
     temple), tried as painted and then larger until its name hangs clear above the protagonist's head.
   - The name on a phone. While someone speaks on a phone the portrait stands right of the protagonist, the speaker's
     name plate at the top left and the book below: the name is carved once more in a low rock beside the
     protagonist (in a room, the marble of a low table screen or a spirit stone; by a path through the hills, a stele
     on its stone tortoise), below the plate, as large as that corner allows (nameCarrier).
   - Spacing and clear zones. A prop is tried at up to 24 places and kept at the first where it hides no part of the
     protagonist (its figure and its formation, in every view it is seen in), no plaque, does not crowd a prop
     already placed (screen overlap), and, if it is big, stays out of the portrait's place in the reading view.
   - Ground contact. Everything standing sinks into the stage's mist at its foot (the layer's sink and mist band),
     as the stage does for the protagonist; the props are painted with their own soft contact shadow; what stands in
     the sea sinks at the water line.
   - Jitter. Fronts and props vary their size by a few per cent and are mirrored at random where the picture
     allows (never the one carrying the name).
   - Budget. At most BUDGET.pieces cards, BUDGET.files distinct pictures and BUDGET.halfBytes of half-size pictures
     (what a phone downloads); optional pieces are left out first.
   - Palette. The place's region leans the colours (palette.ts).
   - Sky. The shared sky is turned a little for each place (SceneFile.sky.azimuth: other clouds, the moon and the sun
     elsewhere), only as far as keeps every view under the panorama, and always so that the sun stands left of the
     protagonist: today's scenes put it right by its head in the lit hours. */
import type { BankLayer, CardLayer, SceneFile } from '../../contracts';
import {
  overlap, screenBox, screenOf, seenOnPlane, TALL, WIDE, worldAt, type Cam, type CardBox, type Rect, type Rig, type Side,
  type Vec3,
} from './geometry';
import { aspect, MASK, paintedCells, rigOf, type KitElement, type KitFile, type Place, type Plaque } from './kit';
import { sceneMood } from './mood';
import { hoursOf, nightTint, paletteOf, type RegionPalette } from './palette';
import { Random, slug } from './random';

export const BUDGET = { pieces: 28, files: 12, halfBytes: 800_000 } as const;

// Where the main portrait stands while someone speaks (portraits.ts placePortrait), as fractions of the reading
// view: the right third of a desktop; on a phone the middle right of the strip of picture above the book.
export const PORTRAIT_ZONE: Readonly<Record<Side, Rect>> = { wide: [0.64, 0, 1, 1], tall: [0.42, 0.08, 0.98, 0.6] };
// The reading column and its feathered veil cover the left of a desktop's reading view (界面规范第九节, lab.ts
// readingVeil): a name must stand right of this to be read.
export const COLUMN = 0.48;
// Where a phone's reading view still shows the picture while someone speaks: under the status strip and the speaker's
// name plate at the top left (NamePlate.module.css: 104 px down, a name of up to four characters), above the book (the
// lower three fifths) and left of the portrait. The protagonist's figure stands in it too: the name stands left of the
// figure, low, near the horizon.
export const PHONE_FREE: Rect = [0.01, 0.26, 0.41, 0.41];
// the longest names a plaque and the rock a phone shows take (a longer name leaves them blank)
export const LONGEST = { plaque: 6, phone: 4 } as const;
// the rooms of a look nobody hangs a plaque in (and a natural hollow, a look with no structure)
export const UNMARKED: ReadonlySet<string> = new Set(['storeroom', 'cellar']);
// the grounds too broad to have subjects of their own in the wild: any subject that fits stands there
const BROAD_GROUND: ReadonlySet<string> = new Set(['mountain', 'valley']);
// what a look names that leaves a place wild: overgrown, rocky, with bones or graves about (see wild)
const UNTENDED: ReadonlySet<string> = new Set(['vines', 'rocks', 'bones', 'graves']);
// whether a place's room has no plaque on its wall: its name is only on the low stone a phone shows, if anywhere
export const unmarkedRoom = (kit: KitFile, place: Place): boolean =>
  kit.layout === 'room' && !!place.look && (place.look.structure === 'none' || UNMARKED.has(place.look.structure));

// The views in which the protagonist must stay clear (the close-up looks past it). Nothing may stand in front of its
// figure in any of them, nor in front of its formation in the views that show the formation (cultivating and the
// breakthrough); behind it, only its figure is kept clear, in the views where it is the subject (in the breakthrough's
// close views it fills the screen, and the gate behind it is meant to be seen).
const VIEWS: readonly [string, Side][] = [
  ['idle', 'wide'], ['read', 'wide'], ['cult', 'wide'], ['sheet', 'wide'], ['cine1', 'wide'], ['cine2', 'wide'],
  ['idle', 'tall'], ['read', 'tall'], ['cult', 'tall'], ['sheet', 'tall'], ['cine1', 'tall'], ['cine2', 'tall'],
];
const MAIN_VIEWS = VIEWS.filter(([preset]) => !preset.startsWith('cine'));
// The rock with the name a phone shows stands beside the protagonist, where there is barely room for it: on a phone
// it may stand behind the figure's edge (its field may not, see nameCarrier), and with a panel open it may too; on a
// desktop it stays clear of the figure while the protagonist is the subject.
export const PHONE_NAME_VIEWS: readonly [string, Side][] = [['idle', 'wide'], ['read', 'wide'], ['cult', 'wide']];
const FORMATION_VIEWS = new Set(['cult', 'cine1', 'cine2']);
// the presets whose views must be covered edge to edge (the breakthrough's pull-back may see the far ends fade)
const CORE = ['idle', 'read', 'sheet', 'cult', 'close', 'cine1'] as const;
const ASPECT: Record<Side, number> = { wide: WIDE, tall: TALL };
// the protagonist (a standing figure, 3.1 tall, a little over two across with its sleeves) and its formation
const FIGURE = { half: 1.15, height: 3.5 };
const RING = 2.6;
// a prop this tall on the reading view's screen, or nearer than this, counts as big
const BIG = { share: 0.3, z: -5 };

const FAR = { gain: 0.42, haze: 0.6, mist: 0.6, mistHaze: 1, edge: 0.05 };
// what a street keeps of its download budget for its props and the big thing at the frame's edge
const FRAME_RESERVE = 260_000;

export interface PlaqueSpec {
  // the layer that carries it, and the file (without the fragment) whose picture it is written on
  layer: number;
  file: string;
  text: string;
  box: Plaque['box'];
  ink: Plaque['ink'];
  vertical: boolean;
}

export interface Composition {
  scene: SceneFile;
  // the plaques the place's name is written on: the subject's, and the rock's a phone shows
  plaques: PlaqueSpec[];
  // what was picked, in order, for the review sheets
  picks: string[];
  pieces: number;
  files: string[];
  // the distinct pictures' full and half sizes in bytes
  bytes: [number, number];
  // how many candidate places each clear-zone rule turned down
  rejected: Record<string, number>;
  // where the plaques' fields are in the world
  plaqueBoxes: CardBox[];
}

export interface ComposeOptions {
  // default: the place's id
  seed?: string;
}

// ---------------------------------------------------------------- the place's words

const NAME_TAGS: readonly [string, readonly string[]][] = [
  ['capital', ['京', '皇城', '圣城', '王城']],
  ['city', ['城', '府', '州', '郡']],
  ['town', ['镇']],
  ['village', ['村', '沟']],
  ['clan', ['族', '驻地']],
  ['manor', ['家', '堡', '庄']],
  ['hall', ['院', '斋', '堂', '盟', '总部', '道']],
  ['tower', ['阁', '楼']],
  ['sect', ['宗', '门', '派', '教', '坛']],
  ['palace', ['宫', '殿']],
  ['island', ['岛', '洲']],
  ['temple', ['观']],
  ['valley', ['谷', '坞']],
  ['mountain', ['山']],
];
const WORD_TAGS: readonly [string, readonly string[]][] = [
  ['water', ['江', '河', '湖', '水路', '港', '渡', '临水', '洲']],
  ['wall', ['城墙', '巨石', '易守难攻', '要塞', '坚固']],
  ['market', ['商', '繁华', '市', '店', '铺', '交易', '拍卖', '贩卖', '买卖']],
  ['port', ['港', '码头', '贸易', '补给', '据点', '人口众多', '中转', '传送阵', '海滨重镇']],
  ['fishing', ['猎', '渔', '捕', '珍珠', '珊瑚', '鱼']],
  ['rustic', ['偏僻', '宁静', '淳朴', '村', '乡']],
  ['grand', ['繁华', '皇', '金碧辉煌', '都城', '圣地', '宏伟', '核心', '巨']],
  ['dark', ['魔', '血', '鬼', '阴', '煞', '毒', '邪', '骨']],
  ['fire', ['火', '焰', '炎', '阳']],
  ['cold', ['冰', '寒', '雪', '北']],
  ['beast', ['兽', '妖', '御灵', '灵兽', '狐']],
  ['sword', ['剑', '刀', '兵']],
  // a sect of women, a fairyland: the moon gate and the palace on its peak
  ['grace', ['女修', '女弟子', '仙境', '月']],
  ['dry', ['沙', '漠', '草原', '荒']],
  // a shop's drawers of medicine, a cave's herbs
  ['medicine', ['药', '丹', '医', '灵草', '百草']],
  // a temple of the Buddha's teaching: its hall keeps a bronze image, a bell and a drum
  ['buddhist', ['寺', '庙', '佛', '禅', '僧', '雷音', '贝叶', '金罗', '西灵', '圣殿']],
  // the forests and marshes: a cave grown through with roots
  ['forest', ['林', '森', '莽', '泽', '藤', '树', '木']],
  // a house that is an inn, a tavern or a teahouse (its rooms take after it: an inn's room has the inn's wall)
  ['inn', ['客栈', '驿站', '客舍', '客店', '旅店']],
  ['tavern', ['酒楼', '酒肆', '酒馆', '酒家', '饭馆']],
  ['teahouse', ['茶楼', '茶馆', '茶肆', '茶坊']],
];

// What a place's look (contracts PlaceLook) adds besides its own values: the words the kits were tagged with before
// looks (a hut is rustic, a snowfield cold, an eerie place dark, an alchemy room's furnace medicine).
const LOOK_TAGS: Readonly<Record<string, readonly string[]>> = {
  snowfield: ['cold'], ice: ['cold'], desert: ['dry'], grassland: ['dry'], fire: ['fire'], furnace: ['fire', 'medicine'],
  swamp: ['forest', 'water'], river: ['water'], lake: ['water'], waterfall: ['water'], coast: ['water'], stream: ['water'],
  pond: ['water'], hut: ['rustic'], dormitory: ['rustic'], room: ['rustic'], workshop: ['rustic'], tent: ['rustic'],
  field: ['rustic'], alchemy_room: ['medicine'], herb_beds: ['medicine'], cabinets: ['medicine'], eerie: ['dark'],
  bones: ['dark'], tomb: ['dark'], cell: ['dark'], bandit_hall: ['dark'], forest: ['forest'], vines: ['forest'],
  path: ['mountain'], cliff: ['mountain'], peak: ['mountain'], canyon: ['mountain'], valley: ['valley'],
};

// The words a place carries: from the ending of its name, from words in its name and description, from its region
// (the seas favour water), and from its look (each of its values, and LOOK_TAGS). Elements list the words that make
// them likelier, and those they need.
export function placeTags(place: Place, palette: RegionPalette = paletteOf(place.region)): Set<string> {
  const tags = new Set<string>(palette.tags ?? []);
  const name = place.name;
  for (const [tag, endings] of NAME_TAGS) if (endings.some((e) => name.includes(e))) tags.add(tag);
  const text = `${name} ${place.description ?? ''}`;
  for (const [tag, words] of WORD_TAGS) if (words.some((w) => text.includes(w))) tags.add(tag);
  if (place.kind) tags.add(place.kind);
  const look = place.look;
  if (look) {
    for (const value of [look.setting, look.terrain, look.structure, look.scale, look.mood, ...look.features]) {
      if (value === 'none') continue;
      tags.add(value);
      for (const tag of LOOK_TAGS[value] ?? []) tags.add(tag);
    }
    // a hollow under the ground nobody built (a cave, a crevice, a drain): nothing cut or made in its rock
    if (look.structure === 'none' && look.setting === 'underground') tags.add('natural');
    // a small room of a teahouse or a tavern: its private room (雅间)
    if ((look.structure === 'teahouse' || look.structure === 'tavern') && look.scale === 'narrow') tags.add('private');
  }
  return tags;
}

function weightOf(el: KitElement, tags: Set<string>, boost: number): number {
  const hits = (el.tags ?? []).filter((t) => tags.has(t)).length;
  const avoided = (el.avoid ?? []).some((t) => tags.has(t));
  return (el.weight ?? 1) * (1 + boost * hits) * (avoided ? 0.08 : 1);
}

// ---------------------------------------------------------------- the protagonist's clear zone

// The screen rectangles the protagonist covers under one view, as fractions widened by `pad`: its figure, and (unless
// `ring` is false) the formation that lies on the ground round its feet. Null when it is behind the camera.
export function protagonistRects(cam: Cam, side: Side, anchor: Vec3, pad = 0.015, ring = true): Rect[] | null {
  const a = ASPECT[side];
  const rect = (pts: Vec3[]): Rect | null => {
    const s = pts.map((p) => screenOf(cam, a, p));
    if (s.some((v) => !v)) return null;
    const xs = s.map((v) => v![0]);
    const ys = s.map((v) => v![1]);
    return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
  };
  const [x, y, z] = anchor;
  const figure = rect([
    [x - FIGURE.half, y, z], [x + FIGURE.half, y, z], [x - FIGURE.half, y + FIGURE.height, z], [x + FIGURE.half, y + FIGURE.height, z],
  ]);
  if (!figure) return null;
  if (!ring) return [figure];
  const formation = rect([[x - RING, y, z - RING], [x + RING, y, z - RING], [x - RING, y, z + RING * 0.5], [x + RING, y, z + RING * 0.5]]);
  return formation ? [figure, formation] : [figure];
}

const area = (r: Rect) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
const inFrame = (r: Rect): Rect | null => {
  const c: Rect = [Math.max(0, r[0]), Math.max(0, r[1]), Math.min(1, r[2]), Math.min(1, r[3])];
  return c[2] > c[0] && c[3] > c[1] ? c : null;
};

// ---------------------------------------------------------------- building the layers

type Layer = CardLayer | BankLayer;
type Paint = Partial<Omit<CardLayer, 'type' | 'file' | 'w' | 'h' | 'x' | 'y' | 'z'>>;

interface Placed {
  el: KitElement;
  box: CardBox;
  layer: CardLayer;
}

// The world rectangles of the painted cells of a card.
export function cellBoxes(el: KitElement, box: CardBox, flip = false): CardBox[] {
  const cw = box.w / MASK;
  const ch = box.h / MASK;
  return paintedCells(el, flip).map(([col, row]) => ({
    x: box.x - box.w / 2 + (col + 0.5) * cw, y: box.y + box.h - (row + 1) * ch, z: box.z, w: cw, h: ch,
  }));
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

class Builder {
  readonly kit: KitFile;
  readonly place: Place;
  readonly rng: Random;
  readonly palette: RegionPalette;
  readonly tags: Set<string>;
  readonly rig: Rig;
  readonly G: number;
  readonly S: Vec3;
  readonly layers: Layer[] = [];
  readonly picks: string[] = [];
  readonly props: Placed[] = [];
  readonly files = new Map<string, KitElement>();
  pieces = 0;
  readonly plaques: PlaqueSpec[] = [];
  readonly plaqueBoxes: CardBox[] = [];
  heroFile = '';

  constructor(kit: KitFile, place: Place, seed: string) {
    this.kit = kit;
    this.place = place;
    this.rng = new Random(`${kit.id}|${seed}`);
    this.palette = paletteOf(place.region);
    this.tags = placeTags(place, this.palette);
    this.rig = rigOf(kit);
    this.G = kit.ground;
    this.S = kit.base.anchors.player as unknown as Vec3;
  }

  role(role: KitElement['role']): KitElement[] {
    return this.kit.elements.filter((e) => e.role === role);
  }

  // what the place may have at all: the elements whose needed words it has (all of them if it has none of those)
  allowed(items: KitElement[]): KitElement[] {
    const ok = items.filter((e) => !e.need || e.need.some((t) => this.tags.has(t)));
    return ok.length ? ok : items;
  }

  // whether a place whose look is known would nearly rule it out (a temple's bell or a crane in a bandits' hall): then
  // it is left out, not merely made unlikely as it is by a place's words alone
  ruledOut(e: KitElement): boolean {
    return !!this.place.look && (e.avoid ?? []).some((t) => this.tags.has(t));
  }

  pick(items: KitElement[], boost = 2): KitElement | null {
    return this.rng.pick(this.allowed(items), (e) => weightOf(e, this.tags, boost));
  }

  // Candidates for the scene's subject, those that fit the place best first: the most of the place's words in
  // common and none it avoids (a capital's gate for a capital, an ancestral hall for a clan), in an order drawn by
  // weight among equals; then the rest, likewise. Places of a kind share the subjects that fit it, at random.
  subjects(all: KitElement[]): KitElement[] {
    const items = this.allowed(all);
    const score = (e: KitElement) => ((e.avoid ?? []).some((t) => this.tags.has(t)) ? -1 : (e.tags ?? []).filter((t) => this.tags.has(t)).length);
    const scores = [...new Set(items.map(score))].sort((a, b) => b - a);
    return scores.flatMap((s) => this.rng.order(items.filter((e) => score(e) === s), (e) => e.weight ?? 1));
  }

  get halfBytes(): number {
    let sum = 0;
    for (const el of this.files.values()) sum += el.bytes[1];
    return sum;
  }

  // whether a picture more (or one already used) still fits the budget, with `pieces` more cards, leaving `reserve`
  // bytes for what comes after it
  fits(el: KitElement, pieces = 1, reserve = 0): boolean {
    if (this.pieces + pieces > BUDGET.pieces) return false;
    if (this.files.has(el.file)) return true;
    return this.files.size + 1 <= BUDGET.files && this.halfBytes + el.bytes[1] <= BUDGET.halfBytes - reserve;
  }

  card(el: KitElement, box: CardBox, paint: Paint, flip = false): CardLayer {
    const tint = nightTint(this.palette, paint.tintNight as [number, number, number] | undefined);
    const layer: CardLayer = {
      type: 'card', file: fileOf(el), w: r3(box.w), h: r3(box.h), x: r3(box.x), y: r3(box.y), z: r3(box.z),
      ...(flip ? { flip: true } : {}),
      ...paint,
      // a picture painted lighter than the room's light is shown darker (KitElement.tone)
      ...(el.tone !== undefined ? { gain: r3((paint.gain ?? 0.5) * el.tone) } : {}),
      ...(tint ? { tintNight: tint } : {}),
    };
    if (!tint) delete layer.tintNight;
    this.layers.push(layer);
    this.files.set(el.file, el);
    this.pieces++;
    return layer;
  }

  // the part of the plane at z that the usual views show, sway included
  extent(z: number) {
    return seenOnPlane(this.rig, z, undefined, CORE);
  }

  // A band across the whole view: copies of the picture side by side, every other one mirrored, overlapping by
  // their faded ends, from `centre` out to both ends of what the views show.
  band(el: KitElement, centre: number, z: number, foot: number, w: number, h: number, paint: Paint): number {
    const ext = this.extent(z);
    const edge = paint.edge ?? 0.0001;
    const step = w * (1 - edge);
    let lo = 0;
    while (centre + lo * step - w / 2 > ext.x0) lo--;
    let hi = 0;
    while (centre + hi * step + w / 2 < ext.x1) hi++;
    for (let k = lo; k <= hi; k++) this.card(el, { x: centre + k * step, y: foot, z, w, h }, paint, Math.abs(k) % 2 === 1);
    return hi - lo + 1;
  }

  // A far silhouette band: its `top` row at screen height topAt and its body (`foot` row) at baseAt under the idle
  // view, its feature at xAt.
  farBand(el: KitElement, z: number, xAt: number, topAt: number, baseAt: number, extra: Paint): void {
    const cam = this.rig.idle!.wide;
    const hi = worldAt(cam, WIDE, xAt, topAt, z);
    const lo = worldAt(cam, WIDE, xAt, baseAt, z);
    const h = (hi[1] - lo[1]) / (el.foot - (el.top ?? 0));
    const w = h * aspect(el);
    const centre = hi[0] - ((el.feature ?? 0.5) - 0.5) * w;
    const foot = lo[1] - (1 - el.foot) * h;
    this.band(el, centre, z, foot, w, h, { ...FAR, mistLo: r3(lo[1] - 2), mistHi: r3(lo[1] + 2), ...extra });
    this.picks.push(`far:${el.id}`);
  }

  // ---- the clear zones

  // Whether the painted part of a card (its mask's cells) would hide the protagonist, or stand right behind it (in
  // `behind` views when it stands behind).
  blocksProtagonist(box: CardBox, el?: KitElement, flip = false, behind: readonly [string, Side][] = MAIN_VIEWS): boolean {
    const front = box.z > this.S[2] - 1;
    const cells = el ? cellBoxes(el, box, flip) : [box];
    for (const [preset, side] of front ? VIEWS : behind) {
      const cam = this.rig[preset]?.[side];
      if (!cam) continue;
      const rects = protagonistRects(cam, side, this.S, 0.015, front && FORMATION_VIEWS.has(preset));
      const b = screenBox(cam, ASPECT[side], box);
      if (!rects || !b) continue;
      for (const rect of rects) {
        const seen = inFrame(rect);
        if (!seen || overlap(seen, b) <= 0) continue;
        for (const cell of cells) {
          const c = screenBox(cam, ASPECT[side], cell);
          if (c && overlap(seen, c) > 0) return true;
        }
      }
    }
    return false;
  }

  inPortraitZone(box: CardBox): boolean {
    for (const side of ['wide', 'tall'] as const) {
      const b = screenBox(this.rig.read![side], ASPECT[side], box);
      if (b && overlap(b, PORTRAIT_ZONE[side]) > 0) return true;
    }
    return false;
  }

  isBig(box: CardBox): boolean {
    if (box.z > BIG.z) return true;
    const b = screenBox(this.rig.read!.wide, WIDE, box);
    return !!b && b[3] - b[1] > BIG.share;
  }

  coversPlaque(box: CardBox, el?: KitElement, flip = false): boolean {
    const behind = this.plaqueBoxes.filter((p) => box.z > p.z);
    if (!behind.length) return false;
    const cells = el ? cellBoxes(el, box, flip) : [box];
    for (const [preset, side] of [['read', 'wide'], ['idle', 'wide'], ['read', 'tall']] as const) {
      const cam = this.rig[preset]![side];
      for (const plaque of behind) {
        const p = screenBox(cam, ASPECT[side], plaque);
        if (!p) continue;
        for (const cell of cells) {
          const c = screenBox(cam, ASPECT[side], cell);
          if (c && overlap(p, c) > 0) return true;
        }
      }
    }
    return false;
  }

  // Whether a prop would crowd one already standing at about the same depth (a near tree over a far hall is fine), but
  // for those of the roles named.
  crowds(box: CardBox, besides: readonly KitElement['role'][] = []): boolean {
    for (const other of this.props) {
      if (Math.abs(other.box.z - box.z) > 10 || besides.includes(other.el.role)) continue;
      for (const [preset, side] of [['read', 'wide'], ['idle', 'wide'], ['read', 'tall']] as const) {
        const cam = this.rig[preset]![side];
        const a = screenBox(cam, ASPECT[side], box);
        const b = screenBox(cam, ASPECT[side], other.box);
        if (!a || !b) continue;
        const o = overlap(a, b);
        if (o > 0.12 * Math.min(area(a), area(b))) return true;
      }
    }
    return false;
  }

  // Whether the painted part of something already standing before the field of the name a phone shows would hide
  // any of it there (on a desktop the plaque carries the name).
  fieldHidden(field: CardBox): boolean {
    for (const other of this.props) {
      if (other.box.z <= field.z) continue;
      const cells = cellBoxes(other.el, other.box, !!other.layer.flip);
      for (const [preset, side] of [['read', 'tall']] as const) {
        const cam = this.rig[preset]![side];
        const f = screenBox(cam, ASPECT[side], field);
        if (!f) continue;
        for (const cell of cells) {
          const c = screenBox(cam, ASPECT[side], cell);
          if (c && overlap(f, c) > 0) return true;
        }
      }
    }
    return false;
  }

  // why candidate places were turned down, for the review and the tests
  readonly rejected: Record<string, number> = {};

  private reject(reason: string): false {
    this.rejected[reason] = (this.rejected[reason] ?? 0) + 1;
    return false;
  }

  clear(box: CardBox, near: boolean, el?: KitElement, flip = false): boolean {
    if (this.blocksProtagonist(box, el, flip)) return this.reject('protagonist');
    if (this.coversPlaque(box, el, flip)) return this.reject('plaque');
    if (this.crowds(box)) return this.reject('crowded');
    if ((near || this.isBig(box)) && this.inPortraitZone(box)) return this.reject('portrait');
    return true;
  }

  // A prop stood with its foot at `ground`, tried at up to 24 places along x (from `xs`); kept at the first clear one.
  stand(el: KitElement, z: number, ground: number, xs: () => number, paint: Paint, opts: { near?: boolean; flip?: boolean } = {}): Placed | null {
    if (!this.fits(el)) return null;
    const h = el.height * this.rng.range(0.92, 1.08);
    const w = h * aspect(el);
    const flip = opts.flip ?? (el.mirror !== false && this.rng.chance(0.5));
    for (let i = 0; i < 24; i++) {
      const box: CardBox = { x: xs(), y: ground - (1 - el.foot) * h, z, w, h };
      if (!this.clear(box, !!opts.near, el, flip)) continue;
      const layer = this.card(el, box, paint, flip);
      const placed = { el, box, layer };
      this.props.push(placed);
      this.picks.push(`${opts.near ? 'near' : 'prop'}:${el.id}`);
      return placed;
    }
    return null;
  }

  // A big thing at the frame's left edge, near the camera: its hold point (a tree's trunk) at the idle view's left
  // edge, sunk into the mist from `footY`; mirrored when its trunk is on the right, so it leans into the picture.
  // It starts at a random point of `at` (screen x of the hold point) and moves out of the frame until it is clear,
  // giving up once less than a twentieth of the view would still show it.
  edge(el: KitElement, z: number, footY: number, paint: Paint, at: [number, number] = [-0.02, 0.08]): Placed | null {
    if (!this.fits(el)) return null;
    const hold = el.hold ?? [0.5, el.foot];
    const flip = hold[0] > 0.55 || (hold[0] >= 0.45 && el.mirror !== false && this.rng.chance(0.5));
    const hx = flip ? 1 - hold[0] : hold[0];
    const h = el.height * this.rng.range(0.94, 1.06);
    const w = h * aspect(el);
    const cam = this.rig.idle!.wide;
    // a thing standing on its own (a pole) keeps its hold point in the frame; a tree may lean in from outside it
    const least = el.role === 'near' ? -1 : 0.015;
    for (let sx = this.rng.range(at[0], at[1]); sx >= least; sx -= 0.012) {
      const x = worldAt(cam, WIDE, sx, 0.8, z)[0] - (hx - 0.5) * w;
      const box: CardBox = { x, y: footY - (1 - hold[1]) * h, z, w, h };
      const seen = screenBox(cam, WIDE, box);
      if (!seen || seen[2] < 0.05) return null;
      if (!this.clear(box, true, el, flip)) continue;
      const layer = this.card(el, box, paint, flip);
      const placed = { el, box, layer };
      this.props.push(placed);
      this.picks.push(`near:${el.id}`);
      return placed;
    }
    return null;
  }

  // The first of up to `tries` candidates (picked by weight, none twice) that finds a clear place.
  edgeOf(candidates: KitElement[], used: Set<string>, tries: number, place: (el: KitElement) => Placed | null): Placed | null {
    // what the place has the words for (none of a bandits' post in a temple), nothing it rules out
    const left = candidates.filter((e) => !used.has(e.id) && !this.ruledOut(e) && (!e.need || e.need.some((t) => this.tags.has(t))));
    for (let n = 0; n < tries; n++) {
      const el = this.pick(left);
      if (!el) return null;
      left.splice(left.indexOf(el), 1);
      const placed = place(el);
      if (placed) {
        used.add(el.id);
        return placed;
      }
    }
    return null;
  }

  // the name goes on this layer's plaque (left blank when the name is too long for it)
  setPlaque(el: KitElement, layer: CardLayer, box: CardBox): void {
    const p = el.plaque!;
    this.plaqueBoxes.push(fieldOf(el, box));
    if (Array.from(this.place.name).length > (el.only === 'name' ? LONGEST.phone : LONGEST.plaque)) return;
    this.plaques.push({
      layer: this.layers.indexOf(layer), file: el.file, text: this.place.name, box: p.box, ink: p.ink, vertical: !!p.vertical,
    });
    layer.file = `${fileOf(el)}#${slug(this.place.id)}`;
  }

  // The name once more where a phone shows it while someone speaks (PHONE_FREE: the portrait stands right of the
  // protagonist, the status strip and the speaker's name plate over it, the book under it): carved across a low rock
  // standing on `ground` between `zs` (behind the protagonist and its formation), its field left of the protagonist's
  // figure in the phone's reading view, hiding nothing of the protagonist and no plaque. There is little room there:
  // the rock is sized and set so its field is as large on a phone as it can be (largest first, a rock of 1 to 4
  // high); none when the name is too long for it.
  nameCarrier(zs: [number, number], ground: number, paint: Paint): Placed | null {
    const carriers = this.kit.elements.filter((e) => e.only === 'name' && e.plaque && !this.ruledOut(e));
    if (!carriers.length || Array.from(this.place.name).length > LONGEST.phone) return null;
    const el = this.pick(carriers)!;
    if (!this.fits(el)) return null;
    const cam = this.rig.read!.tall;
    const figure = protagonistRects(cam, 'tall', this.S, 0.015, false)?.[0] ?? null;
    const [px0, , px1] = el.plaque!.box;
    const tries: { z: number; h: number; right: number }[] = [];
    for (let z = zs[1]; z >= zs[0] - 1e-6; z -= 0.45) {
      for (let h = 4; h >= 1.0 - 1e-6; h -= 0.2) for (const right of [0.2, 0.18, 0.16, 0.14]) tries.push({ z, h, right });
    }
    // the largest on a phone first; then, failing those, further left (a room's main piece may stand wide beside it)
    tries.sort((a, b) => b.h / (cam[2] - b.z) - a.h / (cam[2] - a.z) || b.right - a.right);
    const further = tries.map((t) => ({ ...t, right: t.right - 0.07 })).filter((t) => t.right >= 0.07);
    tries.push(...further);
    for (const { z, h, right } of tries) {
      const w = h * aspect(el);
      // the field's right edge at a screen x left of the figure
      const fieldX = worldAt(cam, TALL, Math.min(right, (figure?.[0] ?? 0.21) - 0.005), 0.34, z)[0] - ((px1 - px0) * w) / 2;
      const box: CardBox = { x: fieldX - ((px0 + px1) / 2 - 0.5) * w, y: ground - (1 - el.foot) * h, z, w, h };
      const seen = screenBox(cam, TALL, fieldOf(el, box));
      if (!seen || seen[0] < PHONE_FREE[0] || seen[1] < PHONE_FREE[1] || seen[2] > PHONE_FREE[2] || seen[3] > PHONE_FREE[3]) {
        this.reject('phone name');
        continue;
      }
      if (figure && overlap(figure, seen) > 0) {
        this.reject('phone name');
        continue;
      }
      if (this.blocksProtagonist(box, el, false, PHONE_NAME_VIEWS)) {
        this.reject('protagonist');
        continue;
      }
      if (this.coversPlaque(box, el, false)) {
        this.reject('plaque');
        continue;
      }
      // a room's main piece may stand near it, but none of it before the name
      if (this.crowds(box, ['furniture']) || this.fieldHidden(fieldOf(el, box))) {
        this.reject('crowded');
        continue;
      }
      const layer = this.card(el, box, paint, false);
      const placed = { el, box, layer };
      this.props.push(placed);
      this.setPlaque(el, layer, box);
      this.picks.push(`name:${el.id}`);
      return placed;
    }
    return null;
  }
}

// The address of an element's picture in its kit's folder, with its digest when the kit has one (kit.json `v`): a
// browser may keep a picture asked for so.
export function fileOf(el: KitElement): string {
  return el.v ? `${el.file}?v=${el.v}` : el.file;
}

// where a plaque's field is in the world, for a card of its picture
function fieldOf(el: KitElement, box: CardBox): CardBox {
  const [x0, y0, x1, y1] = el.plaque!.box;
  return { x: box.x + ((x0 + x1) / 2 - 0.5) * box.w, y: box.y + (1 - y1) * box.h, z: box.z, w: (x1 - x0) * box.w, h: (y1 - y0) * box.h };
}

// ---------------------------------------------------------------- a street (城镇·街市)

function street(b: Builder): number {
  const { rng, G } = b;
  const floor = G - 2.2;
  // the far town: one band, sometimes a second, hazier one behind it
  const fars = b.role('far');
  const far = b.pick(fars)!;
  b.farBand(far, -64, rng.range(0.36, 0.6), rng.range(0.205, 0.245), 0.315, { sink: [r3(floor), r3(floor + 8)] });
  const second = rng.chance(0.45) ? b.pick(fars.filter((e) => e !== far)) : null;
  if (second && b.fits(second, 3)) {
    b.farBand(second, -96, rng.range(0.2, 0.8), rng.range(0.19, 0.215), 0.295, {
      sink: [r3(floor), r3(floor + 10)], gain: 0.4, haze: 0.78,
    });
  }

  // the street's surface, behind the fronts: their plinths stand on its top line
  const ground = b.pick(b.role('ground'))!;
  const gh = ground.height * rng.range(0.95, 1.05);
  const gw = gh * aspect(ground) * (ground.stretch ?? 1);
  const gz = -33;
  const groundPaint: Paint = {
    order: 1.0, gain: 0.5, haze: 0.7, mist: 0.9, mistLo: r3(floor), mistHi: G + 0.8, mistHaze: 1, sink: [r3(floor), r3(G - 0.4)], edge: 0.03,
  };
  b.band(ground, b.S[0] + rng.range(-10, 10), gz, G + 0.3 - (1 - (ground.top ?? 0)) * gh, gw, gh, groundPaint);
  b.picks.push(`ground:${ground.id}`);

  // the row of fronts, the subject first: a front with a plaque, picked by the place's words and set where its plaque
  // reads in the reading view (right of the reading column, left of the portrait) without the protagonist's figure
  // in front of it there or in the idle view; the first candidate that has such a place is taken
  const fronts = b.role('front');
  const frontPaint: Paint = {
    order: 1.0, gain: 0.5, haze: 0.7, mist: 0.9, mistLo: r3(floor), mistHi: G + 0.8, mistHaze: 1, sink: [r3(G - 0.45), r3(G + 0.12)],
  };
  const read = b.rig.read!.wide;
  const idle = b.rig.idle!.wide;
  const heroZ = -29.2;
  const figure = (cam: Cam) => protagonistRects(cam, 'wide', b.S, 0.01, false)?.[0] ?? null;
  // the top of what is painted, as a fraction of its height (else the first row of its mask with a painted cell)
  const topOf = (el: KitElement) => el.crown ?? Math.min(...paintedCells(el).map(([, row]) => row)) / MASK;
  const hosts = b.subjects(fronts.filter((e) => e.plaque));
  let hero = hosts[0]!;
  let heroBox: CardBox | null = null;
  // where the plaque's centre may go across the reading view, tried from a random one onwards
  const targets = Array.from({ length: 19 }, (_, i) => 0.47 + i * 0.01);
  const start = Math.floor(rng.range(0, targets.length));
  search: for (const el of hosts) {
    const h = el.height * rng.range(0.97, 1.03);
    const w = h * aspect(el);
    const [px0, py0, px1, py1] = el.plaque!.box;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[(start + i) % targets.length]!;
      const x = worldAt(read, WIDE, t, 0.35, heroZ)[0] - ((px0 + px1) / 2 - 0.5) * w;
      const box: CardBox = { x, y: G - (1 - el.foot) * h, z: heroZ, w, h };
      const field: CardBox = { x: x + ((px0 + px1) / 2 - 0.5) * w, y: box.y + (1 - py1) * h, z: heroZ, w: (px1 - px0) * w, h: (py1 - py0) * h };
      const onRead = screenBox(read, WIDE, field);
      const onIdle = screenBox(idle, WIDE, field);
      // right of the reading column, left of the portrait's place (the speaker's name plate stands at its left edge)
      if (!onRead || !onIdle || onRead[0] < COLUMN || onRead[2] > PORTRAIT_ZONE.wide[0]) continue;
      // the whole building inside the idle view, its roof under the frame's top
      const roof = screenOf(idle, WIDE, [x, box.y + (1 - topOf(el)) * h, heroZ]);
      if (!roof || roof[1] < 0.01 || onIdle[1] < 0.02) {
        b.rejected[`subject roof ${el.id}`] = (b.rejected[`subject roof ${el.id}`] ?? 0) + 1;
        continue;
      }
      const hidden = [[read, onRead], [idle, onIdle]].some(([cam, r]) => {
        const f = figure(cam as Cam);
        return !!f && overlap(f, r as Rect) > 0;
      });
      if (hidden) {
        b.rejected[`subject figure ${el.id}`] = (b.rejected[`subject figure ${el.id}`] ?? 0) + 1;
        continue;
      }
      hero = el;
      heroBox = box;
      break search;
    }
  }
  if (!heroBox) {
    // no clear place: the first candidate, its plaque just right of the reading column
    const h = hero.height;
    const w = h * aspect(hero);
    const x = worldAt(read, WIDE, 0.47, 0.35, heroZ)[0] - ((hero.plaque!.box[0] + hero.plaque!.box[2]) / 2 - 0.5) * w;
    heroBox = { x, y: G - (1 - hero.foot) * h, z: heroZ, w, h };
    b.picks.push('hero-unclear');
  }
  const heroLayer = b.card(hero, heroBox, frontPaint);
  b.setPlaque(hero, heroLayer, heroBox);
  b.heroFile = hero.file;
  b.picks.push(`hero:${hero.id}`);

  // the rest of the row, out to both ends of the view: neighbours meet wall to wall (their bodies, not their eaves),
  // overlapping a little, the nearer one hiding the seam; never the same front twice side by side. Each is sized so
  // its lower eave runs at the street's eave height (within a tenth of its usual size: a cottage stays low, a hall on
  // its high plinth stands a little above the rest), so the eaves run along the street instead of jumping; the
  // street's eaves are low enough, and a front too tall is left out, that the subject stands above the row.
  const fillers = fronts.filter((e) => e.only !== 'hero' && e !== hero);
  const heroTop = heroBox.y + heroBox.h * (1 - topOf(hero));
  const eaves = Math.min(rng.range(5.4, 5.8), (heroTop - G - 1) / 2.45);
  const levelOf = (el: KitElement): number => {
    if (el.eave === undefined) return el.height;
    return Math.min(el.height * 1.1, Math.max(el.height * 0.9, eaves / (el.foot - el.eave)));
  };
  const sizeOf = (el: KitElement): number => levelOf(el) * (el.eave === undefined ? rng.range(0.95, 1.05) : rng.range(0.99, 1.01));
  const underHero = (el: KitElement) => G + (el.foot - topOf(el)) * levelOf(el) * 1.01 <= heroTop - 1;
  const bodyOf = (el: KitElement): [number, number] => el.body ?? [0, 1];
  // a row of fronts from a built one outwards to `reach` either side (z alternating about `z`)
  const row = (from: Placed, z: number, reach: [number, number], pool: () => KitElement[], paint: Paint, label: string, cap = Infinity): void => {
    for (const dir of [1, -1] as const) {
      const hb = bodyOf(from.el);
      let edgeX = from.box.x - from.box.w / 2 + (dir > 0 ? hb[1] : hb[0]) * from.box.w;
      let previous: KitElement = from.el;
      for (let d = 1; (dir > 0 ? edgeX < reach[1] : edgeX > reach[0]) && b.pieces < cap; d++) {
        const choices = pool().filter((e) => e !== previous);
        const el = b.pick(choices.length ? choices : pool())!;
        const h = sizeOf(el);
        const w = h * aspect(el);
        const flip = el.mirror !== false && rng.chance(0.5);
        const [bl, br] = flip ? [1 - bodyOf(el)[1], 1 - bodyOf(el)[0]] : bodyOf(el);
        const lap = rng.range(0.3, 1.0);
        // its body's near end at the previous body's far end, overlapping by `lap`
        const x = dir > 0 ? edgeX - lap + (0.5 - bl) * w : edgeX + lap - (br - 0.5) * w;
        const at = z + (d % 2 ? -0.35 : 0.35) + rng.range(-0.2, 0.2);
        b.card(el, { x, y: G - (1 - el.foot) * h, z: at, w, h }, paint, flip);
        b.picks.push(`${label}:${el.id}`);
        edgeX = x - w / 2 + (dir > 0 ? br : bl) * w;
        previous = el;
      }
    }
  };
  const ext = b.extent(-30);
  const lower = fillers.filter(underHero);
  const rowPool = lower.length >= 2 ? lower : fillers;
  row({ el: hero, box: heroBox, layer: heroLayer }, -30.25, [ext.x0, ext.x1], () => {
    // a new front only while it leaves room for the props and the tree at the frame's edge; else one already shown
    const usable = rowPool.filter((e) => b.fits(e, 1, FRAME_RESERVE));
    // nothing new fits: the cheapest one (the row must reach the ends of the view)
    return usable.length > 1 ? usable : [...rowPool].sort((p, q) => p.bytes[1] - q.bytes[1]).slice(0, 2);
  }, frontPaint, 'front');

  // through an archway the street goes on: its surface and a few fronts further down it, behind the archway only,
  // from pictures already in the row (nothing more to download)
  if (hero.opening && b.pieces + 6 <= BUDGET.pieces) {
    const backZ = -47;
    const backPaint: Paint = { ...frontPaint, gain: 0.48, haze: 0.8 };
    const shown = fillers.filter((e) => b.files.has(e.file));
    b.card(ground, { x: heroBox.x, y: G + 0.3 - (1 - (ground.top ?? 0)) * gh, z: backZ - 1.2, w: heroBox.w * 1.5, h: gh }, {
      ...groundPaint, haze: 0.8, edge: 0.25,
    });
    const first = b.pick(shown)!;
    const h = sizeOf(first);
    const w = h * aspect(first);
    const box: CardBox = { x: heroBox.x + rng.range(-0.15, 0.15) * heroBox.w, y: G - (1 - first.foot) * h, z: backZ, w, h };
    const layer = b.card(first, box, backPaint, first.mirror !== false && rng.chance(0.5));
    b.picks.push(`back:${first.id}`);
    const half = heroBox.w * 0.55;
    row({ el: first, box, layer }, backZ, [heroBox.x - half, heroBox.x + half], () => shown, backPaint, 'back', BUDGET.pieces - 4);
  }

  // props along the street, in front of the fronts
  const propPaint: Paint = {
    order: 1.6, gain: 0.5, haze: 0.55, mist: 0.85, mistLo: r3(floor), mistHi: G + 1.0, mistHaze: 1, sink: [r3(G - 0.55), r3(G + 0.05)],
  };
  // the name first where a phone shows it: on a rock at the way into the street, beside the protagonist
  b.nameCarrier([-7, -2.6], G, { ...propPaint, haze: 0.4 });
  const streetProps = b.kit.elements.filter((e) => e.role === 'prop' && !e.only && (e.depths ?? ['mid']).includes('mid'));
  const count = 2 + (rng.chance(0.5) ? 1 : 0);
  const used = new Set<string>();
  for (let n = 0; n < count; n++) {
    const el = b.pick(streetProps.filter((e) => !used.has(e.id)));
    if (!el) break;
    used.add(el.id);
    const z = rng.range(-26, -21);
    const x0 = worldAt(idle, WIDE, 0.04, 0.6, z)[0];
    const x1 = worldAt(idle, WIDE, 0.96, 0.6, z)[0];
    b.stand(el, z, G, () => rng.range(x0, x1), propPaint);
  }

  // the frame's left edge: a tree or a pole near the camera, and sometimes a smaller thing further in
  const nearPaint: Paint = {
    order: 2.3, gain: 0.5, haze: 0.3, mist: 0.75, mistLo: r3(floor), mistHi: G + 1.2, mistHaze: 1, sink: [r3(floor), G],
  };
  // a tree: so close to the camera a pole or a banner shows only in pieces (its lanterns hanging from nothing, a
  // banner filling a corner), so those stand further back in the street
  const trees = b.kit.elements.filter((e) => e.role === 'near');
  b.edgeOf(trees, used, 2, (el) => b.edge(el, rng.range(3.0, 4.6), G - 0.6, nearPaint));
  if (rng.chance(0.4)) {
    const low = b.kit.elements.filter((e) => e.role === 'prop' && e.depths?.includes('near') && e.height < 8 && !used.has(e.id));
    const el = b.pick(low);
    if (el) {
      const z = rng.range(1.5, 2.8);
      const x0 = worldAt(idle, WIDE, 0.1, 0.8, z)[0];
      const x1 = worldAt(idle, WIDE, 0.34, 0.8, z)[0];
      b.stand(el, z, G - 0.4, () => rng.range(x0, x1), { ...nearPaint, order: 2.4, sink: [r3(floor + 0.4), G] }, { near: true });
    }
  }
  return G - 0.12;
}

// ---------------------------------------------------------------- a coast (海岸)

// The protagonist on a reef, a pier or a beach at the water's edge, the sea far out with islands on its horizon, an
// island or a stack out on the water, a boat or two, and the name high on one of five subjects (an archway on the pier
// for a port, a watchtower, a sea god's temple, a tower lighthouse, a fishing village's stilt house), placed as a
// street's subject is; on a phone, carved in a low rock beside the protagonist.
function coast(b: Builder): number {
  const { rng, G, S } = b;
  const sea = b.kit.sea ?? -2.2;
  const read = b.rig.read!.wide;
  const idle = b.rig.idle!.wide;
  // the sea, far out, as the coast scene lays it
  const water = b.role('sea')[0];
  if (water) {
    const h = water.height;
    b.band(water, rng.range(-60, 140), -260, -60.578, h * aspect(water), h, {
      gain: 0.5, haze: 0.45, mist: 0.4, mistLo: -60.578, mistHi: 1, mistHaze: 1, sink: [-3, 5],
    });
    b.picks.push(`sea:${water.id}`);
  }
  // a range on the horizon
  const horizon = screenOf(idle, WIDE, [S[0], idle[1], -4000])?.[1] ?? 0.4;
  const far = b.pick(b.role('far'));
  if (far) b.farBand(far, -185, rng.range(0.3, 0.75), horizon - rng.range(0.035, 0.06), horizon + 0.004, { sink: [r3(sea - 2), r3(sea + 3)] });

  // what the protagonist stands on, where the coast scene's reef stands
  const ground = b.pick(b.role('ground'))!;
  const gh = ground.height * rng.range(0.97, 1.03);
  const gw = gh * aspect(ground);
  b.card(ground, { x: S[0] - 0.3 + rng.range(-1.5, 1.5), y: G - (1 - (ground.top ?? 0.12)) * gh, z: -1.5, w: gw, h: gh }, {
    order: 1.0, gain: 0.5, haze: 0.4, mist: 0.9, mistLo: -2, mistHi: 1, mistHaze: 1, sink: [r3(sea), -0.4], aura: 0.25,
  }, ground.mirror !== false && rng.chance(0.5));
  b.picks.push(`ground:${ground.id}`);

  // the subject: its name right of the reading column, left of the portrait, clear of the protagonist's figure and
  // inside the idle view; an archway stands on the shore, the others in the water
  const figure = (cam: Cam) => protagonistRects(cam, 'wide', S, 0.01, false)?.[0] ?? null;
  const inWater = (el: KitElement) => !!el.water;
  const paintOf = (el: KitElement): Paint => inWater(el)
    ? { order: 0.9, gain: 0.5, haze: 0.55, mist: 0.7, mistLo: r3(sea - 1), mistHi: r3(sea + 2.5), mistHaze: 1, sink: [r3(sea - 0.5), r3(sea + 0.8)] }
    : { order: 0.9, gain: 0.5, haze: 0.5, mist: 0.85, mistLo: r3(sea), mistHi: G + 0.5, mistHaze: 1, sink: [r3(G - 0.8), r3(G + 0.1)] };
  const hosts = b.subjects(b.role('subject'));
  let placed: { el: KitElement; box: CardBox } | null = null;
  search: for (const el of hosts) {
    const size = el.height * rng.range(0.96, 1.04);
    const [px0, py0, px1, py1] = el.plaque!.box;
    const footY = inWater(el) ? sea : G;
    const depths = inWater(el) ? [-16, -20, -24, -28, -32, -36, -40] : [-15, -18, -21, -24];
    const start = Math.floor(rng.range(0, 6));
    // as painted first; a little larger where its name would hang at the protagonist's head
    for (const scale of [1, 1.15, 1.3]) for (const z of depths) {
      const h = size * scale;
      const w = h * aspect(el);
      for (let i = 0; i < 6; i++) {
        const t = 0.5 + ((start + i) % 6) * 0.02;
        const x = worldAt(read, WIDE, t, 0.35, z)[0] - ((px0 + px1) / 2 - 0.5) * w;
        const box: CardBox = { x, y: footY - (1 - el.foot) * h, z, w, h };
        const field: CardBox = { x: x + ((px0 + px1) / 2 - 0.5) * w, y: box.y + (1 - py1) * h, z, w: (px1 - px0) * w, h: (py1 - py0) * h };
        const onRead = screenBox(read, WIDE, field);
        const onIdle = screenBox(idle, WIDE, field);
        if (!onRead || !onIdle || onRead[0] < COLUMN || onRead[2] > PORTRAIT_ZONE.wide[0]) continue;
        const roof = screenOf(idle, WIDE, [x, box.y + (1 - (el.crown ?? 0)) * h, z]);
        if (!roof || roof[1] < 0.01 || onIdle[1] < 0.02) continue;
        if ([[read, onRead], [idle, onIdle]].some(([cam, r]) => {
          const f = figure(cam as Cam);
          return !!f && overlap(f, r as Rect) > 0;
        })) continue;
        placed = { el, box };
        break search;
      }
    }
  }
  if (!placed) {
    const el = hosts[0]!;
    const h = el.height;
    const z = inWater(el) ? -30 : -20;
    const w = h * aspect(el);
    const x = worldAt(read, WIDE, 0.56, 0.35, z)[0] - ((el.plaque!.box[0] + el.plaque!.box[2]) / 2 - 0.5) * w;
    placed = { el, box: { x, y: (inWater(el) ? sea : G) - (1 - el.foot) * h, z, w, h } };
    b.picks.push('hero-unclear');
  }
  const heroLayer = b.card(placed.el, placed.box, paintOf(placed.el));
  b.setPlaque(placed.el, heroLayer, placed.box);
  b.heroFile = placed.el.file;
  b.props.push({ el: placed.el, box: placed.box, layer: heroLayer });
  b.picks.push(`hero:${placed.el.id}`);
  const heroRect = screenBox(read, WIDE, placed.box);

  // an island or a stack out on the water, sometimes two, beside the subject rather than behind it
  const isles = b.role('isle');
  const nIsles = 1 + (rng.chance(0.4) ? 1 : 0);
  const usedIsles = new Set<string>();
  const islePaint: Paint = {
    gain: 0.45, haze: 0.7, mist: 0.6, mistLo: r3(sea - 1), mistHi: r3(sea + 3), mistHaze: 1, sink: [r3(sea - 0.6), r3(sea + 0.8)],
  };
  for (let n = 0; n < nIsles; n++) {
    const el = b.pick(isles.filter((e) => !usedIsles.has(e.id)));
    if (!el || !b.fits(el)) break;
    usedIsles.add(el.id);
    const z = rng.range(-130, -70);
    const h = el.height * rng.range(0.9, 1.1);
    const w = h * aspect(el);
    for (let i = 0; i < 24; i++) {
      const left = rng.chance(0.5);
      const sx = left ? rng.range(0.04, 0.32) : rng.range(0.7, 0.98);
      const x = worldAt(left ? idle : read, WIDE, sx, 0.5, z)[0];
      const box: CardBox = { x, y: sea - (1 - el.foot) * h, z, w, h };
      const r = screenBox(read, WIDE, box);
      if (r && heroRect && overlap(r, heroRect) > 0.12 * area(r)) continue;
      const flip = el.mirror !== false && rng.chance(0.5);
      if (b.blocksProtagonist(box, el, flip) || b.crowds(box)) continue;
      const layer = b.card(el, box, islePaint, flip);
      b.props.push({ el, box, layer });
      b.picks.push(`isle:${el.id}`);
      break;
    }
  }

  // a boat or two on the water
  const boats = b.role('boat');
  const nBoats = 1 + (rng.chance(0.45) ? 1 : 0);
  const usedBoats = new Set<string>();
  const boatPaint: Paint = {
    order: 0.8, gain: 0.48, haze: 0.55, mist: 0.7, mistLo: r3(sea - 1), mistHi: r3(sea + 1.5), mistHaze: 1, sink: [r3(sea - 0.4), r3(sea + 0.4)],
  };
  for (let n = 0; n < nBoats; n++) {
    const el = b.pick(boats.filter((e) => !usedBoats.has(e.id)));
    if (!el) break;
    usedBoats.add(el.id);
    const z = rng.range(-60, -26);
    const x0 = worldAt(idle, WIDE, 0.04, 0.5, z)[0];
    const x1 = worldAt(idle, WIDE, 0.96, 0.5, z)[0];
    b.stand(el, z, sea, () => rng.range(x0, x1), boatPaint);
  }

  // the name where a phone shows it: on a low rock beside the protagonist, on the reef (drawn after it)
  const propPaint: Paint = {
    order: 1.6, gain: 0.5, haze: 0.4, mist: 0.85, mistLo: r3(sea), mistHi: G + 1.0, mistHaze: 1, sink: [r3(G - 0.55), r3(G + 0.05)],
  };
  b.nameCarrier([-4.5, -0.6], G, propPaint);
  // something on the shore beside it, sometimes
  const shore = b.kit.elements.filter((e) => e.role === 'prop' && !e.only);
  const used = new Set<string>();
  if (rng.chance(0.6)) {
    const el = b.pick(shore);
    if (el) {
      used.add(el.id);
      const z = rng.range(-1.4, -0.6);
      const side = rng.chance(0.5);
      const x0 = worldAt(idle, WIDE, side ? 0.04 : 0.66, 0.7, z)[0];
      const x1 = worldAt(idle, WIDE, side ? 0.36 : 0.96, 0.7, z)[0];
      b.stand(el, z, G, () => rng.range(x0, x1), propPaint);
    }
  }

  // the frame's left edge: rocks or a pine on a rock, near the camera, rising from the sea
  const nearPaint: Paint = {
    order: 2.3, gain: 0.48, haze: 0.3, mist: 0.8, mistLo: -3, mistHi: 2, mistHaze: 1, sink: [r3(sea), r3(sea + 1)],
  };
  b.edgeOf(b.role('near'), used, 2, (el) => b.edge(el, rng.range(1.0, 3.5), sea + 0.6, nearPaint, [-0.04, 0.06]));
  return -3;
}

// ---------------------------------------------------------------- the wild (山野：田地、树林、山道、峡谷、河岸、沼泽、遗迹)

// What of a kit's pieces a place may have: those whose needed words it has (none when it has none of them, unlike
// Builder.allowed: a room has no furniture of another kind of room).
function fitting(b: Builder, items: KitElement[]): KitElement[] {
  return items.filter((e) => !e.need || e.need.some((t) => b.tags.has(t)));
}

// Of the pieces a place may have, those made for its own terrain (a field's path between herb beds before the forest
// path a valley's name also lets it have), else all of them; `strict`: none when none is (a ruin has no band).
function ofTerrain(b: Builder, items: KitElement[], strict = false): KitElement[] {
  const terrain = b.place.look?.terrain;
  const own = terrain ? fitting(b, items).filter((e) => e.need?.includes(terrain)) : [];
  return own.length || strict ? own : fitting(b, items);
}

// The protagonist on the ground of the place's terrain, seen from behind and a little above as a coast's reef is (a
// path between herb beds, a forest path, a narrow rocky way, a pebble bank, a boardwalk, a ruined terrace); a far range
// on the horizon; behind the subject a band of the terrain across the view where the look has one (terraced herb beds,
// the edge of a forest, a river, a marsh); the name on a subject that fits the place (a stele, a cliff face with a
// carved field, a pavilion, a waterfall, a ruined gate, a thatched hut, a bandits' stockade), placed as a coast's
// subject is; in a narrow canyon a wall of rock either side closing in; the place's own things about it, what its look
// names first; at the frame's edge what grows there (an old tree, bamboo, reeds); on a phone, the name carved in a low
// rock beside the protagonist.
function wild(b: Builder): number {
  const { rng, G, S } = b;
  const floor = r3(G - 2.6);
  // the haze floor, under the ground the protagonist stands on, which shows down to the frame's foot as a coast's reef
  const haze = r3(G - 6.5);
  const read = b.rig.read!.wide;
  const idle = b.rig.idle!.wide;
  const look = b.place.look;
  const narrow = look?.scale === 'narrow' || b.tags.has('canyon');

  // the far range: its body on the mist, its peaks well under the frame's top
  const fars = fitting(b, b.role('far'));
  const far = b.pick(fars.length ? fars : b.role('far'));
  if (far) b.farBand(far, -200, rng.range(0.3, 0.7), rng.range(0.13, 0.18), 0.32, { sink: [floor, r3(floor + 9)] });

  // the terrain across the view behind the subject, where the place's terrain has one; ruins have the other of their
  // far rows nearer instead (a colonnade, floating rocks), so they do not stand on a bare plain
  const ruinRows = look?.terrain === 'ruins' ? fars.filter((e) => e !== far && e.need?.includes('ruins')) : [];
  const band = b.pick(ofTerrain(b, b.role('band'), true)) ?? b.pick(ruinRows);
  if (band) {
    b.farBand(band, -44, rng.range(0.35, 0.65), rng.range(0.19, 0.23), 0.5, { gain: 0.48, haze: 0.42 });
  }

  // what the protagonist stands on
  const ground = b.pick(ofTerrain(b, b.role('ground'))) ?? b.pick(b.role('ground'));
  if (ground) {
    const gh = ground.height * rng.range(0.97, 1.03);
    const gw = gh * aspect(ground);
    b.card(ground, { x: S[0] - 0.3 + rng.range(-1.2, 1.2), y: G - (1 - (ground.top ?? 0.15)) * gh, z: -1.5, w: gw, h: gh }, {
      order: 1.0, gain: 0.5, haze: 0.4, mist: 0.9, mistLo: haze, mistHi: r3(G - 1.2), mistHaze: 1, sink: [r3(haze - 1), r3(G - 4)], aura: 0.25,
    }, ground.mirror !== false && rng.chance(0.5));
    b.picks.push(`ground:${ground.id}`);
  }

  // the subject: its name right of the reading column, left of the portrait, clear of the protagonist's figure and
  // inside the idle view, as a coast's
  const figure = (cam: Cam) => protagonistRects(cam, 'wide', S, 0.01, false)?.[0] ?? null;
  const subjectPaint: Paint = {
    order: 0.9, gain: 0.5, haze: 0.5, mist: 0.85, mistLo: floor, mistHi: r3(G + 0.5), mistHaze: 1, sink: [r3(G - 0.8), r3(G + 0.1)],
  };
  // the first tried is drawn by weight (the place's words tip it), so places of a kind are not all alike; then the
  // others, those that fit it best first. A place that is a building of the wild (a pavilion, a hut, a stockade) is
  // that building: its own subjects are tried before any other.
  const fitted = fitting(b, b.role('subject')).filter((e) => !b.ruledOut(e));
  const structure = look?.structure;
  const terrain = look?.terrain;
  // A place that names no building and is left wild (desolate, overgrown, rocky: a fugitive's hiding place in a
  // forest, a scree slope) shows nothing built where something grown or rocky fits it: an old tree with its board, a
  // cliff face, a natural arch; no pavilion or lodge the story never mentions.
  const untended = structure === 'none' && (look?.mood === 'desolate' || (look?.features ?? []).some((f) => UNTENDED.has(f)));
  const grown = untended ? fitted.filter((e) => !e.made) : [];
  const fits = grown.length ? grown : fitted.length ? fitted : b.role('subject');
  // else, on a particular ground (a field, a forest, a canyon, the mouth of a cave, the grassland), the subjects of
  // that ground (the broad mountain and valley take any that fits)
  const ofStructure = structure && structure !== 'none' ? fits.filter((e) => e.tags?.includes(structure)) : [];
  const ofGround = terrain && !BROAD_GROUND.has(terrain) ? fits.filter((e) => e.tags?.includes(terrain)) : [];
  const own = ofStructure.length ? ofStructure : ofGround;
  const drawnHost = b.pick(own.length ? own : fits);
  const hosts = drawnHost
    ? [drawnHost, ...b.subjects(own).filter((e) => e !== drawnHost), ...b.subjects(fits).filter((e) => e !== drawnHost && !own.includes(e))]
    : [];
  let placed: { el: KitElement; box: CardBox } | null = null;
  search: for (const el of hosts) {
    const size = el.height * rng.range(0.96, 1.04);
    const [px0, py0, px1, py1] = el.plaque!.box;
    const start = Math.floor(rng.range(0, 6));
    // as painted first; larger where its name would hang at the protagonist's head (a low hut, a stele)
    for (const scale of [1, 1.12, 1.25, 1.4, 1.55]) for (const z of [-14, -17, -20, -24, -28]) {
      const h = size * scale;
      const w = h * aspect(el);
      for (let i = 0; i < 6; i++) {
        const t = 0.5 + ((start + i) % 6) * 0.02;
        const x = worldAt(read, WIDE, t, 0.35, z)[0] - ((px0 + px1) / 2 - 0.5) * w;
        const box: CardBox = { x, y: G - (1 - el.foot) * h, z, w, h };
        const field: CardBox = { x: x + ((px0 + px1) / 2 - 0.5) * w, y: box.y + (1 - py1) * h, z, w: (px1 - px0) * w, h: (py1 - py0) * h };
        const onRead = screenBox(read, WIDE, field);
        const onIdle = screenBox(idle, WIDE, field);
        if (!onRead || !onIdle || onRead[0] < COLUMN || onRead[2] > PORTRAIT_ZONE.wide[0]) continue;
        const roof = screenOf(idle, WIDE, [x, box.y + (1 - (el.crown ?? 0)) * h, z]);
        if (!roof || roof[1] < 0.01 || onIdle[1] < 0.02) continue;
        if ([[read, onRead], [idle, onIdle]].some(([cam, r]) => {
          const f = figure(cam as Cam);
          return !!f && overlap(f, r as Rect) > 0;
        })) continue;
        placed = { el, box };
        break search;
      }
    }
  }
  if (!placed && hosts.length) {
    const el = hosts[0]!;
    const h = el.height;
    const w = h * aspect(el);
    const x = worldAt(read, WIDE, 0.56, 0.35, -20)[0] - ((el.plaque!.box[0] + el.plaque!.box[2]) / 2 - 0.5) * w;
    placed = { el, box: { x, y: G - (1 - el.foot) * h, z: -20, w, h } };
    b.picks.push('hero-unclear');
  }
  if (placed) {
    const heroLayer = b.card(placed.el, placed.box, subjectPaint);
    b.setPlaque(placed.el, heroLayer, placed.box);
    b.heroFile = placed.el.file;
    b.props.push({ el: placed.el, box: placed.box, layer: heroLayer });
    b.picks.push(`hero:${placed.el.id}`);
  }

  // a canyon: a wall of rock at either side, rising out of the frame, the far one mirrored
  const sides = fitting(b, b.role('side'));
  if (narrow && sides.length) {
    const el = b.pick(sides)!;
    // drawn before the ground (whose rocks rise in front of their feet), after the subject
    const sidePaint: Paint = {
      order: 0.95, gain: 0.46, haze: 0.45, mist: 0.8, mistLo: floor, mistHi: r3(G + 1), mistHaze: 1, sink: [floor, r3(G - 0.3)],
    };
    for (const [left, z, sx] of [[true, rng.range(-8, -5), rng.range(0.17, 0.24)], [false, rng.range(-18, -13), rng.range(0.8, 0.86)]] as const) {
      const h = el.height * rng.range(0.95, 1.08);
      const w = h * aspect(el);
      const cam = left ? idle : read;
      // the wall's open edge (its right side as painted) at the screen x sx; the right one is mirrored
      const edgeX = worldAt(cam, WIDE, sx, 0.5, z)[0];
      const x = left ? edgeX - w * 0.45 : edgeX + w * 0.45;
      const box: CardBox = { x, y: G - (1 - el.foot) * h, z, w, h };
      if (b.blocksProtagonist(box, el, !left) || b.coversPlaque(box, el, !left)) {
        b.rejected['side'] = (b.rejected['side'] ?? 0) + 1;
        continue;
      }
      const layer = b.card(el, box, sidePaint, !left);
      b.props.push({ el, box, layer });
      b.picks.push(`side:${el.id}`);
    }
  }

  // the place's things: what its look names first, then what fits it, about the subject and the path
  const propPaint: Paint = {
    order: 1.6, gain: 0.5, haze: 0.45, mist: 0.85, mistLo: floor, mistHi: r3(G + 1.0), mistHaze: 1, sink: [r3(G - 0.55), r3(G + 0.05)],
  };
  b.nameCarrier([-7, -2.6], G, { ...propPaint, haze: 0.35 });
  const things = fitting(b, b.kit.elements.filter((e) => e.role === 'prop' && !e.only && !b.ruledOut(e)));
  const named = new Set<string>(look?.features ?? []);
  const first = things.filter((e) => (e.tags ?? []).some((t) => named.has(t)));
  const used = new Set<string>();
  const count = 2 + (rng.chance(0.5) ? 1 : 0);
  for (let n = 0; n < count; n++) {
    const pool = (n < 2 ? first : things).filter((e) => !used.has(e.id));
    const el = b.pick(pool.length ? pool : things.filter((e) => !used.has(e.id)));
    if (!el) break;
    used.add(el.id);
    const z = rng.range(-13, -5);
    const x0 = worldAt(idle, WIDE, 0.04, 0.6, z)[0];
    const x1 = worldAt(idle, WIDE, 0.96, 0.6, z)[0];
    b.stand(el, z, G, () => rng.range(x0, x1), propPaint);
  }

  // the frame's left edge: what grows there, near the camera
  const nearPaint: Paint = {
    order: 2.3, gain: 0.48, haze: 0.3, mist: 0.75, mistLo: floor, mistHi: r3(G + 1.2), mistHaze: 1, sink: [floor, r3(G - 0.2)],
  };
  const nears = fitting(b, b.role('near'));
  b.edgeOf(nears.length ? nears : b.role('near'), used, 2, (el) => b.edge(el, rng.range(2.6, 4.4), G - 0.6, nearPaint));
  return haze;
}

// ---------------------------------------------------------------- a sect's gate (宗门·山门)

function gate(b: Builder): number {
  const { rng, G, S } = b;
  const floor = r3(G - rng.range(6.3, 7.6));
  // the far range over the cloud sea
  const far = b.pick(b.role('far'))!;
  b.farBand(far, -220, rng.range(0.45, 0.62), rng.range(0.18, 0.22), 0.4, { sink: [floor, r3(floor + 8)] });
  // the cloud bank, as the gate scene lays it
  const bank = b.role('bank')[0];
  if (bank && b.kit.bankRows) {
    const tint = nightTint(b.palette, [0.93, 0.97, 1.05]);
    b.layers.push({
      type: 'bank', file: fileOf(bank), rows: b.kit.bankRows, aspect: r3(aspect(bank)), gain: 0.56, haze: 0.5, mist: 0, edge: 0.05,
      ...(tint ? { tintNight: tint } : {}), tintDay: [2.4, 1.8, 1.5], satDay: 0.5,
    });
    b.files.set(bank.file, bank);
    b.pieces += b.kit.bankRows.length;
  }

  // the gate, where the gate scene sets its own
  const hero = b.subjects(b.role('gate'))[0]!;
  const gz = r3(-9 + rng.range(-0.8, 0.8));
  let gh = hero.height * rng.range(0.97, 1.04);
  // its roof under the idle view's top edge: a tall gate a little smaller (by a fifth at most)
  const roofAt = (h: number) => screenOf(b.rig.idle!.wide, WIDE, [S[0], G + (hero.foot - (hero.crown ?? 0)) * h, gz])?.[1] ?? 1;
  for (let k = 0; k < 20 && roofAt(gh) < 0.015; k++) gh *= 0.99;
  const gw = gh * aspect(hero);
  let gx = S[0] + 0.9 + rng.range(-1.0, 1.2);
  // the gate's name right of the reading column in the reading view: moved right as far as it needs, up to three
  if (hero.plaque) {
    const [px0, py0, px1, py1] = hero.plaque.box;
    const field = (x: number): CardBox => ({
      x: x + ((px0 + px1) / 2 - 0.5) * gw, y: G - (1 - hero.foot) * gh + (1 - py1) * gh, z: gz, w: (px1 - px0) * gw, h: (py1 - py0) * gh,
    });
    for (let shift = 0; shift <= 3; shift += 0.25) {
      const onRead = screenBox(b.rig.read!.wide, WIDE, field(gx + shift));
      if (onRead && onRead[0] >= COLUMN) {
        gx += shift;
        break;
      }
    }
  }
  const gatePaint: Paint = {
    order: 1.0, gain: 0.5, haze: 0.5, mist: 0.9, mistLo: r3(floor + 1), mistHi: G - 1, mistHaze: 1, sink: [r3(floor + 1.5), G - 2.5], aura: 0.2,
  };
  const gateBox: CardBox = { x: gx, y: G - (1 - hero.foot) * gh, z: gz, w: gw, h: gh };
  const gateLayer = b.card(hero, gateBox, gatePaint);
  b.setPlaque(hero, gateLayer, gateBox);
  b.heroFile = hero.file;
  b.picks.push(`hero:${hero.id}`);

  // what it stands on: steps down into the clouds behind its platform, or a terrace whose balustrade hides its foot
  let landing = gw * 0.5;
  if (!hero.whole) {
    const ground = b.pick(b.role('ground'))!;
    const terrace = (ground.top ?? 0) > 0.25;
    const w = terrace ? gw * rng.range(2.1, 2.5) : gw * rng.range(1.65, 1.85);
    const h = w / aspect(ground);
    const z = terrace ? gz + 0.6 : gz - 0.4;
    b.card(ground, { x: gx, y: G + 0.05 - (1 - (ground.top ?? 0)) * h, z, w, h }, {
      order: 1.0, gain: 0.5, haze: 0.5, mist: 0.9, mistLo: r3(floor + 1), mistHi: G - 1, mistHaze: 1, sink: [r3(floor + 1), G - 2.5],
      edge: terrace ? 0.12 : 0.0001,
    });
    b.picks.push(`ground:${ground.id}`);
    landing = terrace ? w * 0.42 : w * 0.24;
  }

  // buildings rising from the cloud sea behind
  const backs = b.role('backdrop');
  const nBack = (rng.chance(0.8) ? 1 : 0) + (rng.chance(0.35) ? 1 : 0);
  const backPaint: Paint = {
    gain: 0.45, haze: 0.75, mist: 0.7, mistLo: floor, mistHi: r3(floor + 6), mistHaze: 1, sink: [r3(floor - 1), r3(floor + 3.5)],
  };
  const gateRect = screenBox(b.rig.read!.wide, WIDE, gateBox);
  const usedBack = new Set<string>();
  for (let n = 0; n < nBack; n++) {
    const el = b.pick(backs.filter((e) => !usedBack.has(e.id)));
    if (!el || !b.fits(el)) break;
    usedBack.add(el.id);
    const z = rng.range(-80, -52);
    const h = el.height * rng.range(0.9, 1.1);
    const w = h * aspect(el);
    // a building wider than a third of the view (a palace on its peak) may stand further out and behind the gate's side
    const wide = (() => {
      const r = screenBox(b.rig.read!.wide, WIDE, { x: 0, y: floor, z, w, h });
      return !!r && r[2] - r[0] > 0.33;
    })();
    for (let i = 0; i < 24; i++) {
      const left = rng.chance(0.55);
      const sx = left ? rng.range(wide ? -0.08 : 0.06, wide ? 0.22 : 0.3) : rng.range(0.74, wide ? 1.06 : 0.96);
      const cam = left ? b.rig.idle!.wide : b.rig.read!.wide;
      const x = worldAt(cam, WIDE, sx, 0.5, z)[0];
      const box: CardBox = { x, y: floor - rng.range(0.5, 2.5) - (1 - el.foot) * h, z, w, h };
      const r = screenBox(b.rig.read!.wide, WIDE, box);
      if (r && gateRect && overlap(r, gateRect) > (wide ? 0.3 : 0.12) * area(r)) continue;
      const flip = el.mirror !== false && rng.chance(0.5);
      if (b.blocksProtagonist(box, el, flip) || b.crowds(box)) continue;
      b.card(el, box, backPaint, flip);
      b.props.push({ el, box, layer: b.layers[b.layers.length - 1] as CardLayer });
      b.picks.push(`back:${el.id}`);
      break;
    }
  }

  // guardians on the landing in front of the gate's outer columns, and sometimes one thing more
  const propPaint: Paint = {
    order: 1.6, gain: 0.5, haze: 0.45, mist: 0.85, mistLo: r3(floor + 1), mistHi: G + 0.5, mistHaze: 1, sink: [r3(G - 0.6), r3(G + 0.05)],
  };
  // the name first where a phone shows it: on a rock on the landing, beside the protagonist
  b.nameCarrier([-7, -2.6], G, { ...propPaint, haze: 0.35 });
  const props = b.kit.elements.filter((e) => e.role === 'prop' && !e.only && (e.depths ?? ['mid']).includes('mid'));
  const used = new Set<string>();
  if (!hero.whole && rng.chance(0.85)) {
    // the first pair (by weight) that hides nothing of the protagonist and keeps out of the portrait's place if big
    for (const pair of rng.order(props.filter((e) => e.pair), (e) => weightOf(e, b.tags, 2))) {
      if (!b.fits(pair, 2)) continue;
      const h = pair.height * rng.range(0.94, 1.06);
      const w = h * aspect(pair);
      const z = gz + rng.range(1.0, 1.6);
      const off = Math.max(gw * 0.5 - w * 0.45, landing - w * 0.5);
      const boxes = [-1, 1].map((s): CardBox => ({ x: gx + s * off, y: G - (1 - pair.foot) * h, z, w, h }));
      const ok = boxes.every((box, i) => !b.blocksProtagonist(box, pair, i === 0) && !b.coversPlaque(box, pair, i === 0) && !b.crowds(box)
        && !(b.isBig(box) && b.inPortraitZone(box)));
      if (!ok) continue;
      used.add(pair.id);
      boxes.forEach((box, i) => {
        // the left one mirrored, so both face the steps
        const layer = b.card(pair, box, propPaint, i === 0);
        b.props.push({ el: pair, box, layer });
      });
      b.picks.push(`pair:${pair.id}`);
      break;
    }
  }
  if (rng.chance(0.55)) {
    const el = b.pick(props.filter((e) => !e.pair && !used.has(e.id)));
    if (el) {
      used.add(el.id);
      const z = gz + rng.range(1.6, 2.6);
      b.stand(el, z, G, () => gx + (rng.chance(0.5) ? -1 : 1) * rng.range(0.55, 1.05) * landing, propPaint);
    }
  }

  // the frame's left edge: an old pine, rocks or bamboo near the camera, growing up from below the ground
  const nearPaint: Paint = {
    order: 2.3, gain: 0.48, haze: 0.3, mist: 0.6, mistLo: floor, mistHi: G, mistHaze: 1, sink: [r3(floor + 3), G - 2],
  };
  const big = b.kit.elements.filter((e) => e.role === 'near' || (e.role === 'prop' && !e.only && e.depths?.includes('near')));
  b.edgeOf(big, used, 3, (el) => b.edge(el, rng.range(3.2, 4.8), floor + rng.range(3.2, 4.4), nearPaint, [-0.1, 0.0]));
  return floor;
}

// ---------------------------------------------------------------- a room (店铺, 大殿, 洞府)

type Shaft = NonNullable<NonNullable<SceneFile['effects']>['shafts']>[number];

// A room, laid out as the room scenes are: its back wall a panorama with the floor painted at its foot, mirrored
// copies either side, its top going into shadow and the room's darkness far behind so nothing shows the sky. Against
// the wall, the plaque with the name hung high (right of the reading column, left of the portrait, under the frame's
// top in the idle view) and the furniture: the subject under the plaque (a cabinet, shelves, a doorway; a hall's dais),
// others either side with the wall showing between, none before a window or a doorway painted into the wall nor
// across the posts where its copies meet. On the floor the room's main piece (a counter right of the protagonist; a
// cave's stone table, which the protagonist sits at), something more, and the name once more where a phone shows it;
// near the camera a column at the frame's left edge and a lantern or a valance hanging at the top. Moonlight comes
// in through the wall's windows (the stage draws the shafts). Returns the shafts.
function room(b: Builder): Shaft[] {
  const { rng, G, S } = b;
  const plan = b.kit.room ?? { wallZ: -11, furniture: { z: [-4, -2.5], at: [0.62, 0.8] } };
  const WZ = plan.wallZ;
  const floor = G - 3.2;
  const read = b.rig.read!.wide;
  const idle = b.rig.idle!.wide;
  const roomPaint: Paint = {
    order: 1.0, gain: 0.5, haze: 0.3, mist: 0.5, mistLo: r3(floor), mistHi: r3(G + 0.4), mistHaze: 0, mistGain: 0.35,
  };
  // the room's darkness: nearly black (a wall's bright windows, enlarged ten times far behind, must not show through)
  const dark: Paint = { order: -9.5, gain: 0.02, haze: 0, mist: 0, tintNight: [0.8, 0.9, 1.1] };

  // the back wall: the room's darkness far behind it, three copies mirrored at their joints, the dark over its top.
  // Its ends go dark as painted, so the joints keep out of the middle of the views: wherever along it the room is
  // seen from, the posts where the copies meet stand near the frame's edges or beyond them.
  const walls = b.role('wall').filter((e) => !b.ruledOut(e));
  const wall = b.pick(walls.length ? walls : b.role('wall'))!;
  const ww = wall.width ?? 40;
  const wh = ww / aspect(wall);
  const wallFoot = G - (1 - wall.foot) * wh;
  const wallTop = wallFoot + wh;
  const shade = wall.shade ?? 1.8;
  const wallFlip = wall.mirror !== false && rng.chance(0.5);
  const lo = Math.max(worldAt(idle, WIDE, 0.92, 0.5, WZ)[0], worldAt(read, WIDE, 0.97, 0.5, WZ)[0]) - ww / 2;
  const hi = Math.min(worldAt(idle, WIDE, 0.06, 0.5, WZ)[0], worldAt(read, WIDE, 0.3, 0.5, WZ)[0]) + ww / 2;
  let wx = 0;
  // a fraction across the wall picture to the world, for the copy k (the copies either side are mirrored)
  const along = (k: number, f: number) => {
    const flip = k === 0 ? wallFlip : !wallFlip;
    return wx + k * ww + ((flip ? 1 - f : f) - 0.5) * ww;
  };
  // where nothing may stand or hang against it: its windows, lamps, niches and doorways, and the posts where the
  // copies meet (world x from, to, and y from, to)
  let blocked: [number, number, number, number][] = [];
  const block = () => {
    blocked = [];
    for (const k of [-1, 0, 1]) {
      for (const [f0, f1, t = 0, u = 1] of wall.keep ?? []) {
        const [a, c] = [along(k, f0), along(k, f1)].sort((p, q) => p - q) as [number, number];
        blocked.push([a, c, wallFoot + (1 - u) * wh, wallFoot + (1 - t) * wh]);
      }
      const joint = wx + k * ww + ww / 2;
      blocked.push([joint - 0.04 * ww, joint + 0.04 * ww, -Infinity, Infinity]);
    }
  };
  const free = (x0: number, x1: number, y0 = G, y1 = Infinity) => blocked.every(([a, c, bl, bh]) => x1 <= a || x0 >= c || y1 <= bl || y0 >= bh);

  // furniture against the wall; a natural hollow (a cave, a crevice, the bottom of a well, a drain: a look with no
  // structure) has none, nor anything on its floor that someone made
  const bare = b.place.look?.structure === 'none';
  // nobody hangs a plaque in a natural hollow, a woodshed or a cellar: the name is only on the low stone a phone shows
  const unmarked = unmarkedRoom(b.kit, b.place);
  const uz = WZ + 0.6;
  const unitPaint: Paint = { ...roomPaint, order: 1.02, sink: [r3(G - 0.45), r3(G + 0.12)] };
  const units = bare ? [] : fitting(b, b.role('unit')).filter((e) => !(wall.refuse ?? []).includes(e.id) && !b.ruledOut(e));
  const span = (el: KitElement, x: number, h: number, flip: boolean): [number, number] => {
    const w = h * aspect(el);
    const [bl, br] = el.body ?? [0, 1];
    const [l, r] = flip ? [1 - br, 1 - bl] : [bl, br];
    return [x - w / 2 + l * w, x - w / 2 + r * w];
  };
  // The subject under a plaque: the first (by the place's words) whose top stays under it, a little smaller if it
  // must be, clear of what is painted into the wall; a kit whose rooms are built round a dais (a hall) has only its
  // daises for it. Their order and sizes are drawn once.
  const daises = units.filter((e) => e.only === 'hero');
  // a hall's dais is the one that fits the place best (the Buddha's image in a temple, the tablets in a clan's
  // hall); other rooms draw theirs by weight, the place's words tipping it, so shops of one kind are not all alike
  const drawnUnit = daises.length ? null : b.pick(units);
  const order = daises.length ? b.subjects(daises) : drawnUnit ? [drawnUnit, ...b.subjects(units).filter((e) => e !== drawnUnit)] : [];
  const centres = order.map((el) => ({ el, h: el.height * rng.range(0.97, 1.03) }));
  const centreUnder = (box: CardBox): { el: KitElement; h: number } | null => {
    const under = box.y - 0.35;
    for (const { el, h: size } of centres) {
      const top = (hh: number) => G - (1 - el.foot) * hh + (1 - (el.crown ?? 0)) * hh;
      const h = top(size) > under ? size * Math.max(0.8, (under - G) / (top(size) - G)) : size;
      if (top(h) > under + 1e-6) continue;
      const [x0, x1] = span(el, box.x, h, false);
      if (free(x0, x1, G, top(h)) && b.fits(el, 1, 300_000)) return { el, h };
    }
    return null;
  };
  // whether moonlight comes in through one of the wall's windows within the reading view
  const lit = () => (wall.lights ?? []).some(([fx, fy]) => [-1, 0, 1].some((k) => {
    const seen = screenOf(read, WIDE, [along(k, fx), wallFoot + (1 - fy) * wh, WZ]);
    return !!seen && seen[0] > 0.05 && seen[0] < 0.95;
  }));

  // the plaque, high on the wall: its field right of the reading column and left of the portrait in the reading view,
  // under the frame's top in the idle view, below the dark over the wall, before no window, lamp or niche, with room
  // for the subject under it; the wall is moved along until it finds such a place (and, while it can, one where the
  // moonlight comes in within the reading view). Its style is drawn by weight (the place's words tip it), the others
  // tried after it.
  const pz = WZ + 0.3;
  const drawn = b.pick(b.role('subject'))!;
  const plaques = [drawn, ...b.subjects(b.role('subject')).filter((e) => e !== drawn)];
  let plaque = plaques[0]!;
  let plaqueBox: CardBox | null = null;
  let centre: { el: KitElement; h: number } | null = null;
  const start = Math.floor(rng.range(0, 8));
  const sizes = new Map(plaques.map((el) => [el, el.height * rng.range(0.97, 1.03)]));
  for (let attempt = 0; attempt < 16 && !plaqueBox; attempt++) {
    wx = lo < hi ? rng.range(lo, hi) : (lo + hi) / 2;
    block();
    if (attempt < 10 && wall.lights?.length && !lit()) continue;
    search: for (const el of plaques) {
      const h = sizes.get(el)!;
      const w = h * aspect(el);
      const [px0, py0, px1, py1] = el.plaque!.box;
      for (const sy of plan.plaque ?? [0.15, 0.13, 0.17, 0.11, 0.19]) {
        for (let i = 0; i < 8; i++) {
          const t = 0.51 + ((start + i) % 8) * 0.01;
          const at = worldAt(read, WIDE, t, sy, pz);
          const x = at[0] - ((px0 + px1) / 2 - 0.5) * w;
          const y = at[1] - (1 - (py0 + py1) / 2) * h;
          const box: CardBox = { x, y, z: pz, w, h };
          const onRead = screenBox(read, WIDE, fieldOf(el, box));
          const top = screenOf(idle, WIDE, [x, y + h, pz]);
          if (!onRead || onRead[0] < COLUMN || onRead[2] > PORTRAIT_ZONE.wide[0]) continue;
          if (!top || top[1] < 0.03 || y + h > wallTop - shade + 0.3) continue;
          if (!free(x - w / 2, x + w / 2, y, y + h)) continue;
          // a room with nothing against its wall (a hollow, a bare woodshed) needs nothing under it
          const under = bare || !units.length ? null : centreUnder(box);
          if (!bare && units.length && !under) continue;
          plaque = el;
          plaqueBox = box;
          centre = under;
          break search;
        }
      }
    }
  }
  if (!plaqueBox) {
    const h = plaque.height;
    const w = h * aspect(plaque);
    const at = worldAt(read, WIDE, 0.56, 0.15, pz);
    plaqueBox = { x: at[0], y: at[1] - h / 2, z: pz, w, h };
    b.picks.push('hero-unclear');
  }

  // the darkness: the wall's picture again far behind, so large that what any view sees of it under the wall's foot
  // is its floor (from 70 below down there up to the floor's top line), with a mirrored copy standing on it
  const darkH = 62 / (1 - wall.foot);
  const darkW = darkH * aspect(wall);
  b.card(wall, { x: 4, y: -70, z: -60, w: darkW, h: darkH }, { ...dark, gain: 0.012 });
  b.card(wall, { x: 4, y: -70 + darkH - 0.5, z: -60, w: darkW, h: darkH }, dark, true);
  for (const k of [-1, 0, 1]) {
    b.card(wall, { x: wx + k * ww, y: wallFoot, z: WZ, w: ww, h: wh }, {
      ...roomPaint, sink: [r3(wallFoot), r3(wallFoot + 0.6 * (1 - wall.foot) * wh)],
    }, k === 0 ? wallFlip : !wallFlip);
  }
  b.card(wall, { x: wx, y: wallTop - shade, z: WZ + 0.05, w: 3 * ww, h: 60 }, {
    ...dark, order: 1.05, sink: [r3(wallTop - shade), r3(wallTop)],
  });
  b.picks.push(`wall:${wall.id}`);
  if (unmarked) {
    // the place where the plaque would hang still sets out the room: what stands under it, the rest either side
    b.heroFile = wall.file;
  } else {
    const plaqueLayer = b.card(plaque, plaqueBox, { ...roomPaint, order: 1.08 });
    b.setPlaque(plaque, plaqueLayer, plaqueBox);
    b.heroFile = plaque.file;
    b.picks.push(`hero:${plaque.id}`);
  }

  // the subject under the plaque, then others outwards either side
  const ext = b.extent(uz);
  const placed: { x0: number; x1: number }[] = [];
  const room = (x0: number, x1: number, y1: number) => free(x0, x1, G, y1) && placed.every((p) => x1 <= p.x0 || x0 >= p.x1);
  const unitAt = (el: KitElement, x: number, h: number, z: number, flip: boolean, label: string): CardLayer => {
    const w = h * aspect(el);
    const layer = b.card(el, { x, y: G - (1 - el.foot) * h, z, w, h }, unitPaint, flip);
    const [x0, x1] = span(el, x, h, flip);
    placed.push({ x0, x1 });
    b.picks.push(`${label}:${el.id}`);
    return layer;
  };
  if (centre) unitAt(centre.el, plaqueBox.x, centre.h, uz, centre.el.mirror !== false && rng.chance(0.5), 'unit');
  // others: outwards from the subject, two at most either side, a stretch of bare wall between, none twice, none the
  // place's look rules out
  const others = units.filter((e) => e.only !== 'hero' && !b.ruledOut(e));
  const shown = new Set<KitElement>(centre ? [centre.el] : []);
  for (const dir of [1, -1] as const) {
    let edge = dir > 0 ? Math.max(plaqueBox.x + plaqueBox.w / 2, ...placed.map((p) => p.x1)) : Math.min(plaqueBox.x - plaqueBox.w / 2, ...placed.map((p) => p.x0));
    for (let n = 0; n < 2; n++) {
      const gap = rng.chance(0.3) ? rng.range(3.5, 6) : rng.range(0.8, 2.6);
      const el = b.pick(others.filter((e) => !shown.has(e) && b.fits(e, 1, 200_000)));
      if (!el) break;
      shown.add(el);
      const h = el.height * rng.range(0.95, 1.05);
      const w = h * aspect(el);
      const flip = el.mirror !== false && rng.chance(0.5);
      const [bl, br] = flip ? [1 - (el.body ?? [0, 1])[1], 1 - (el.body ?? [0, 1])[0]] : (el.body ?? [0, 1]);
      let x = dir > 0 ? edge + gap - (bl - 0.5) * w : edge - gap - (br - 0.5) * w;
      // past a window or a post: on beyond it
      for (let tries = 0; tries < 6; tries++) {
        const [x0, x1] = span(el, x, h, flip);
        if (room(x0, x1, G + el.foot * h)) break;
        x += dir * 1.5;
      }
      const [x0, x1] = span(el, x, h, flip);
      if (!room(x0, x1, G + el.foot * h)) break;
      if (dir > 0 ? x0 > ext.x1 : x1 < ext.x0) break;
      unitAt(el, x, h, uz + (n % 2 ? 0.15 : -0.15), flip, 'unit');
      edge = dir > 0 ? x1 : x0;
    }
  }

  // the main piece on the floor: right of the protagonist (a counter), or the stone table the protagonist sits at
  const fPaint: Paint = { ...roomPaint, order: 1.1, aura: 0.3 };
  const furniture = bare ? null : b.pick(fitting(b, b.role('furniture')).filter((e) => !b.ruledOut(e)));
  if (furniture && b.fits(furniture)) {
    const h = furniture.height * rng.range(0.97, 1.03);
    const w = h * aspect(furniture);
    if (plan.seat) {
      // just behind the protagonist, who sits on its cushion
      const box: CardBox = { x: S[0] + 0.2, y: G - 0.2 - (1 - furniture.foot) * h, z: S[2] - 0.4, w, h };
      const layer = b.card(furniture, box, { ...fPaint, order: 1.2, aura: 0.4 });
      b.props.push({ el: furniture, box, layer });
      b.picks.push(`furniture:${furniture.id}`);
    } else {
      // behind the protagonist, as a counter stands in the room scenes: it hides nothing of it
      const flip = furniture.mirror !== false && rng.chance(0.5);
      for (let i = 0; i < 24; i++) {
        const z = rng.range(plan.furniture.z[0], plan.furniture.z[1]);
        const x = worldAt(read, WIDE, rng.range(plan.furniture.at[0], plan.furniture.at[1]), 0.7, z)[0];
        const box: CardBox = { x, y: G - (1 - furniture.foot) * h, z, w, h };
        if (b.coversPlaque(box, furniture, flip)) continue;
        const layer = b.card(furniture, box, fPaint, flip);
        b.props.push({ el: furniture, box, layer });
        b.picks.push(`furniture:${furniture.id}`);
        break;
      }
    }
  }

  // the name where a phone shows it: on something low beside the protagonist
  const propPaint: Paint = { ...roomPaint, order: 1.15 };
  b.nameCarrier([-7, -2.6], G, propPaint);
  // something more on the floor, sometimes two things
  const floorProps = fitting(b, b.kit.elements.filter((e) => e.role === 'prop' && !e.only && !(bare && e.made) && !b.ruledOut(e)));
  const used = new Set<string>();
  const count = 1 + (rng.chance(0.45) ? 1 : 0);
  for (let n = 0; n < count; n++) {
    const el = b.pick(floorProps.filter((e) => !used.has(e.id)));
    if (!el) break;
    used.add(el.id);
    const z = rng.range(-8, -3);
    const left = rng.chance(0.55);
    const x0 = worldAt(idle, WIDE, left ? 0.04 : 0.66, 0.7, z)[0];
    const x1 = worldAt(idle, WIDE, left ? 0.4 : 0.97, 0.7, z)[0];
    b.stand(el, z, G, () => rng.range(x0, x1), propPaint);
  }

  // near the camera: a column at the frame's left edge, and something hanging at the top
  const nearPaint: Paint = {
    order: 2.3, gain: 0.44, haze: 0.15, mist: 0.5, mistLo: r3(floor), mistHi: r3(G + 0.8), mistHaze: 0, mistGain: 0.3,
  };
  // a column rises from below the frame, jars stand on the floor
  b.edgeOf(b.role('near'), used, 2, (el) => b.edge(el, rng.range(4.2, 5.4), el.height > 6 ? floor : G - 0.3, nearPaint, [0.02, 0.1]));
  const hangs = b.role('hang');
  const hang = b.pick(hangs);
  if (hang && b.fits(hang)) {
    const h = hang.height * rng.range(0.95, 1.05);
    const w = h * aspect(hang);
    const wide = w > 12;
    for (let i = 0; i < 12; i++) {
      const z = wide ? rng.range(-1.5, -0.5) : rng.range(1.5, 3);
      // a valance across the top, its lowest folds just inside the frame; a lantern hanging at the top right
      const sx = wide ? rng.range(0.45, 0.7) : rng.range(0.8, 0.95);
      const top = worldAt(read, WIDE, sx, wide ? -0.02 : 0.02, z);
      const box: CardBox = { x: top[0], y: top[1] + (wide ? 0.6 : 0.5) - h, z, w, h };
      if (b.coversPlaque(box, hang) || b.blocksProtagonist(box, hang)) continue;
      const layer = b.card(hang, box, { order: 2.4, gain: 0.48, haze: 0.1, mist: 0 });
      b.props.push({ el: hang, box, layer });
      b.picks.push(`hang:${hang.id}`);
      break;
    }
  }

  // moonlight through the wall's windows: from the two nearest the middle of the reading view, down onto the floor
  // before the wall, leaning towards the middle of the room
  const shafts: Shaft[] = [];
  const mid = worldAt(read, WIDE, 0.6, 0.5, WZ)[0];
  const lights: Vec3[] = [];
  for (const k of [-1, 0, 1]) for (const [fx, fy] of wall.lights ?? []) lights.push([along(k, fx), wallFoot + (1 - fy) * wh, WZ + 0.1]);
  lights.sort((p, q) => Math.abs(p[0] - mid) - Math.abs(q[0] - mid));
  for (const from of lights.slice(0, 2)) {
    const seen = screenOf(read, WIDE, from);
    if (!seen || seen[0] < -0.1 || seen[0] > 1.1) continue;
    const to: Vec3 = [r3(from[0] + (S[0] - from[0]) * 0.35), G, r3(WZ + 6)];
    shafts.push({ from: [r3(from[0]), r3(from[1]), r3(from[2])], to, width: 2, strength: 0.9 });
  }
  return shafts;
}

// ---------------------------------------------------------------- the scene file

// The sky's panorama (sky.ts) spans 100 degrees round its turn and the sun stands 3 degrees right of it, low; the
// views look about 5 degrees right of straight ahead and the widest (2.2:1) sees 36 degrees to either side, the
// pointer's sway a little more.
const SKY = { span: 100, sun: 3, margin: 3, widest: 2.2, tallest: 0.8 };
const deg = (r: number) => (r * 180) / Math.PI;

// The turns of the sky (degrees right of straight ahead) that keep every view under the panorama and the sun off the
// protagonist's figure in the reading and idle views: the ones left of it (wider than any other side for this rig).
export function skyTurns(rig: Rig, anchor: Vec3): [number, number] {
  let left = Infinity;
  let right = -Infinity;
  for (const pair of Object.values(rig)) {
    for (const side of ['wide', 'tall'] as const) {
      const cam = pair[side];
      const yaw = deg(Math.atan2(cam[3] - cam[0], cam[2] - cam[5]));
      const half = deg(Math.atan(Math.tan((cam[6] * Math.PI) / 360) * (side === 'wide' ? SKY.widest : SKY.tallest)));
      left = Math.min(left, yaw - half - SKY.margin);
      right = Math.max(right, yaw + half + SKY.margin);
    }
  }
  // the protagonist's figure, as directions from the reading and the idle cameras
  let figure = Infinity;
  for (const preset of ['read', 'idle']) {
    const cam = rig[preset]!.wide;
    figure = Math.min(figure, deg(Math.atan2(anchor[0] - FIGURE.half - cam[0], cam[2] - anchor[2])));
  }
  return [right - SKY.span / 2, Math.min(left + SKY.span / 2, figure - SKY.sun - SKY.margin)];
}

export function sceneId(kit: KitFile, place: Place): string {
  return `${kit.id}~${slug(place.id)}`;
}

export function compose(kit: KitFile, place: Place, opts: ComposeOptions = {}): Composition {
  const b = new Builder(kit, place, opts.seed ?? place.id);
  let cloudFloor: number | null = null;
  let shafts: Shaft[] = [];
  if (kit.layout === 'room') shafts = room(b);
  else if (kit.layout === 'wild') cloudFloor = wild(b);
  else cloudFloor = kit.layout === 'gate' ? gate(b) : kit.layout === 'coast' ? coast(b) : street(b);
  // the kit's ground fire, over the mist floor the layout leaves (the abyss's, glowing up from below)
  const fire = kit.fire && cloudFloor !== null
    ? [{ at: [b.S[0], r3(cloudFloor + kit.fire.over), kit.fire.z] as [number, number, number], radius: kit.fire.radius }]
    : [];
  const effects = shafts.length || fire.length ? { ...(shafts.length ? { shafts } : {}), ...(fire.length ? { fire } : {}) } : null;
  const base = kit.base;
  // the sound: the terrain's own where the kit has one for it, else the base's; the look's mood may set the music
  const sound = (place.look && kit.sounds?.[place.look.terrain]) || base;
  const hours = hoursOf(b.palette, base.hours);
  const [lo, hi] = skyTurns(b.rig, b.S);
  const sky = { ...base.sky, azimuth: Math.round(b.rng.range(lo, Math.max(lo, hi)) * 10) / 10 };
  const scene: SceneFile = {
    id: sceneId(kit, place),
    name: place.name,
    kind: base.kind,
    indoor: !!base.indoor,
    key: b.heroFile,
    eye: base.eye,
    ...(cloudFloor === null ? {} : { cloudFloor: r3(cloudFloor) }),
    sky,
    layers: b.layers,
    cameras: base.cameras,
    anchors: base.anchors,
    hours,
    weather: base.weather,
    ambience: sound.ambience,
    mood: sceneMood(place.look?.mood, sound.mood),
    ...(base.floor ? { floor: base.floor } : {}),
    ...(base.protagonist ? { protagonist: base.protagonist } : {}),
    ...(effects ? { effects } : {}),
  };
  let full = 0;
  let half = 0;
  for (const el of b.files.values()) {
    full += el.bytes[0];
    half += el.bytes[1];
  }
  return {
    scene, plaques: b.plaques, picks: b.picks, pieces: b.pieces, files: [...b.files.keys()], bytes: [full, half], rejected: b.rejected,
    plaqueBoxes: b.plaqueBoxes,
  };
}
