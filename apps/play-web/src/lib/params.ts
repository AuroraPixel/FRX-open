// Address parameters that pin the page for tests and screenshots. They may stand before the hash
// (/play/?fixture=night#/play/x) or inside it (/play/#/gallery?light=day).
//   fixture=<name>  answer every request from apps/play-web/fixtures/<name>/, never the network
//   speed=<n>       how fast a fixture's event stream replays; 0 delivers it at once
//   seed=<n>        Math.random becomes a seeded generator
//   t=<time>        the clock stands still at this time (ms since 1970 or an ISO date); nothing animates
//   light=night|day force a colour set (the gallery uses it)
//   sheet=<name>    open this panel on the play screen once it is drawn (screenshots of panels in place)
//   webgl=off       the stage's stand-in for browsers without WebGL2 (stills of the scenes), as if WebGL2 failed
//   scene=<id>, hour=night|dawn|day|dusk   with a fixture, its save stands in this scene at this hour (the
//                   small words on the picture are audited where they are hardest to read)
//   place=<名>, region=<名>   with scene=, the save stands in a place of that scene's family composed from its
//                   kit (kit-<scene>), as the server names one (the region leans the colours; default 潮岚道)
//   kind=<id>       with place=, the place's own scene type, which a room composed for it takes after (a shop on
//                   the coast: scene=dianpu&kind=haian)
//   kit=<id>        with place=, the kit it is composed from when not the scene's (kit-<id>: kit=wild, kit=room)
//   look=<setting>,<terrain>,<structure>,<scale>,<mood>[,<feature>…]   with place=, what the place looks like
//                   (contracts PlaceLook), which picks the pieces (look=outdoor,field,none,open,calm,herb_beds)

import type { PlaceLook } from '../contracts';

export interface PagePins {
  fixture?: string;
  speed: number;
  seed?: number;
  t?: number;
  light?: 'night' | 'day';
  sheet?: string;
  webgl?: 'off';
  scene?: string;
  hour?: Hour;
  place?: string;
  region?: string;
  kind?: string;
  kit?: string;
  look?: PlaceLook;
}

export type Hour = 'night' | 'dawn' | 'day' | 'dusk';
const HOURS: readonly Hour[] = ['night', 'dawn', 'day', 'dusk'];

export function readParams(href: string): URLSearchParams {
  const url = new URL(href, 'http://local');
  const params = new URLSearchParams(url.search);
  const hashQuery = url.hash.indexOf('?');
  if (hashQuery >= 0) {
    new URLSearchParams(url.hash.slice(hashQuery + 1)).forEach((value, key) => {
      if (!params.has(key)) params.set(key, value);
    });
  }
  return params;
}

export function parsePins(params: URLSearchParams): PagePins {
  const pins: PagePins = { speed: 1 };
  const fixture = params.get('fixture');
  if (fixture && /^[a-z0-9-]+$/i.test(fixture)) pins.fixture = fixture;
  const speed = Number(params.get('speed'));
  if (params.has('speed') && Number.isFinite(speed) && speed >= 0) pins.speed = speed;
  const seed = Number(params.get('seed'));
  if (params.has('seed') && Number.isFinite(seed)) pins.seed = seed;
  const t = params.get('t');
  if (t) {
    const time = /^\d+$/.test(t) ? Number(t) : Date.parse(t);
    if (Number.isFinite(time)) pins.t = time;
  }
  const light = params.get('light');
  if (light === 'night' || light === 'day') pins.light = light;
  const sheet = params.get('sheet');
  if (sheet && /^[a-z]+$/.test(sheet)) pins.sheet = sheet;
  if (params.get('webgl') === 'off') pins.webgl = 'off';
  const scene = params.get('scene');
  if (scene && /^[a-z]+$/.test(scene)) pins.scene = scene;
  const hour = params.get('hour');
  if (HOURS.includes(hour as Hour)) pins.hour = hour as Hour;
  const place = params.get('place');
  if (place && /^[\u4e00-\u9fff]{1,8}$/.test(place)) pins.place = place;
  const region = params.get('region');
  if (region && /^[\u4e00-\u9fff]{1,8}$/.test(region)) pins.region = region;
  const kind = params.get('kind');
  if (kind && /^[a-z]{2,20}$/.test(kind)) pins.kind = kind;
  const kit = params.get('kit');
  if (kit && /^[a-z]{2,20}$/.test(kit)) pins.kit = kit;
  const look = params.get('look')?.split(',') ?? [];
  if (look.length >= 5 && look.length <= 9 && look.every((word) => /^[a-z_]{2,20}$/.test(word))) {
    const [setting, terrain, structure, scale, mood, ...features] = look;
    pins.look = { setting, terrain, structure, scale, mood, features } as unknown as PlaceLook;
  }
  return pins;
}

let current: PagePins | undefined;

/** The pins of this page load. Read once; changing the hash later does not change them. */
export function pins(): PagePins {
  if (!current) current = parsePins(readParams(globalThis.location?.href ?? 'http://local/'));
  return current;
}

/** Tests replace the pins without touching the address. */
export function setPinsForTest(next: PagePins | undefined): void {
  current = next;
}
