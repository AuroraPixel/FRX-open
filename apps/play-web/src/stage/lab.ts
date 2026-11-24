/* The stage lab (stage-lab.html, development only): the stage alone, set up from the address, for looking at it and
   for screenshots (tools/stage-shots.mjs). When it is done it sets window.__ready and leaves window.__report.

   scene=guanyuntai  hour=night|dawn|day|dusk  weather=clear|cloud|mist|rain|snow
   focus=idle|read|sheet|cult|close|cine1|cine2
   still=1 (default) | 0      seed=…&t=… deterministic: seeded randomness, the clock stopped at t seconds
   fx=cultivate|breakthrough|breakthrough-fail|sword|check|settle|reset   fxs=seconds (cultivate)   outcome=… (check)
   settle=1                   the gold formation of after a breakthrough, before anything else
   recipe=elder | random:<seed>[:<age>] | <JSON>      slot=main|side      side=<recipe for the side slot>
   speaker=main|side          who is speaking
   hero=m|f|none|unset|<recipe>  the protagonist's back view (default: a man in the painted robe; unset: no call at all,
                              and the stage shows nobody until it is told)   pose=sit|stand
   robe=<hex colour>          the protagonist's robe
   scene2=…&hour2=…&weather2=…  then change to this (any of the three); tt=<seconds> shows the change that far in
   motion=full|weak|off       the settings' motion level      covered=1 (a full-height panel over the picture)
   veil=1 (the reading column's veil for this layout) | x,y,w,h      narrow=1 (half-size layers)
   fallback=1 (the no-WebGL2 stand-in)      perf=<seconds> (measure frame times after loading, live mode only)
   kit=check                  prove the TypeScript kit draws exactly what kit.js draws
   robes=1                    measure the main colour of every body in the kit (the protagonist's robe table)
   compose=kit-jieshi&place=回潮渡&region=潮岚道&desc=…&kind=…&look=<PlaceLook JSON>&pid=…&cseed=…
                             instead of `scene`, a scene composed for a place (pid: its id when not its name)
                              from a family's kit (src/stage/compose; kind: the place's own scene type, which a room
                              takes after; cseed overrides the seed, which is the place);
                              compose2=…&place2=…&region2=…&desc2=…&kind2=… then change to another composed scene */
import type { PlaceLook, Recipe } from '../contracts';
import { PortraitKit } from '../kit/kit';
import { compose } from './compose/compose';
import { screenBox, type Cam } from './compose/geometry';
import { loadKit as loadSceneKit, type KitFile } from './compose/kit';
import { mainColour } from './hero';
import {
  create, type FocusPreset, type Hour, type MotionLevel, type PortraitSlot, type Pose, type SceneSpec, type Stage,
  type VeilRect, type Weather,
} from './index';

interface Report {
  robes?: Record<string, [number, number, number]>;
  stage?: string;
  webgl2?: boolean;
  hdr?: boolean;
  renderer?: string;
  size?: [number, number, number];
  errors: string[];
  perf?: Record<string, number>;
  kit?: Record<string, unknown>;
  compose?: Record<string, unknown>;
}

declare global {
  interface Window {
    __ready?: boolean;
    __report?: Report;
    __stage?: Stage;
    PortraitKit?: unknown;
  }
}

const q = new URLSearchParams(location.search);
const ASSETS = q.get('assets') ?? '/play/assets/';
const report: Report = { errors: [] };
window.__report = report;
addEventListener('error', (e) => report.errors.push(String(e.message)));
addEventListener('unhandledrejection', (e) => report.errors.push(String(e.reason)));

const PRESETS: Record<string, Recipe> = {
  // 玄微子 of the prototype stills: snow-white beard to the chest, a Taoist knot with a wooden pin, crane robe and staff
  elder: { base: 'm-old', face: 'face-2-1', hair: 'hair-1-1', body: 'body-a' },
  // a young woman in a white Taoist robe, fox ears, long hair
  fox: { base: 'f-young', face: 'face-2-3', hair: 'hairL-2-1', body: 'body-d', tilt: -2 },
};

async function recipeFrom(text: string | null, kit: () => Promise<PortraitKit>): Promise<Recipe | null> {
  if (!text) return null;
  if (PRESETS[text]) return PRESETS[text];
  if (text.startsWith('random:')) {
    const [, seed, age] = text.split(':');
    return (await kit()).random(seed ?? 'lab', age ? { age: age as 'young' } : undefined);
  }
  return JSON.parse(text) as Recipe;
}

function readingVeil(width: number, height: number): VeilRect {
  if (width < 760) return { x: -400, y: height * 0.41 + 26, w: width + 800, h: height + 400 };
  // the book: 46 px from the left, min(588 px, 52vw) wide on a narrow desktop
  const right = 46 + (width < 1100 ? Math.min(588, width * 0.52) : 588);
  return { x: -400, y: -400, w: 400 + right + 44, h: height + 800 };
}

function probe(): { webgl2: boolean; hdr: boolean; renderer: string } {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return { webgl2: false, hdr: false, renderer: '' };
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  const hdr = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return { webgl2: true, hdr, renderer };
}

// In perf mode every animation-frame callback is timed: the stage's own work per frame (on the main thread).
const busy: number[] = [];
if (Number(q.get('perf') ?? 0) > 0) {
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) =>
    raf((now) => {
      const t0 = performance.now();
      callback(now);
      busy.push(performance.now() - t0);
    });
}

async function measure(seconds: number, stage: Stage): Promise<Record<string, number>> {
  busy.length = 0;
  const counted = stage as unknown as { drawnFrames?: number };
  const drawn0 = counted.drawnFrames ?? 0;
  const times: number[] = [];
  let last = 0;
  await new Promise<void>((resolve) => {
    const end = performance.now() + seconds * 1000;
    const tick = (now: number) => {
      if (last) times.push(now - last);
      last = now;
      if (now < end) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  const sorted = [...times].sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  const work = [...busy].sort((a, b) => a - b);
  const drawn = (counted.drawnFrames ?? 0) - drawn0;
  return {
    frames: times.length, meanMs: mean, p50Ms: at(0.5), p95Ms: at(0.95), fps: 1000 / mean,
    // frames the stage itself drew a second (a covered stage draws at most 30)
    drawnFps: drawn / seconds,
    over34: times.filter((t) => t > 34).length,
    workMeanMs: work.reduce((a, b) => a + b, 0) / Math.max(1, work.length),
    workP95Ms: work[Math.min(work.length - 1, Math.floor(work.length * 0.95))] ?? 0,
  };
}

async function runStage(): Promise<void> {
  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  const seed = q.get('seed');
  const t = q.get('t');
  const tt = q.get('tt');
  const deterministic = seed !== null || t !== null
    ? { seed: seed ?? 'lab', t: Number(t ?? 1.2), ...(tt !== null ? { transitionAt: Number(tt) } : {}) }
    : undefined;
  const motion = (q.get('motion') ?? undefined) as MotionLevel | undefined;
  const stage = create(canvas, {
    assets: ASSETS,
    deterministic,
    narrow: q.has('narrow') ? q.get('narrow') === '1' : undefined,
    fallback: q.get('fallback') === '1',
    ...(motion ? { motion } : {}),
    onError: (error) => report.errors.push(error.message),
  });
  window.__stage = stage;
  let kit: Promise<PortraitKit> | null = null;
  const loadKit = () => (kit ??= PortraitKit.load(`${ASSETS}portrait-kit/manifest.json`));

  stage.still(Number(q.get('still') ?? 1));
  const hero = q.get('hero');
  const pose = (q.get('pose') ?? undefined) as Pose | undefined;
  const robe = q.get('robe') ?? undefined;
  if (hero === 'unset') {
    // the page has not said who the player is yet
  } else if (hero === 'none') void stage.protagonist(null);
  else if (hero === 'm' || hero === 'f') void stage.protagonist({ sex: hero, pose, robe });
  else if (hero) {
    const recipe = await recipeFrom(hero, loadKit);
    if (recipe) void stage.protagonist({ recipe, pose, robe });
  } else void stage.protagonist({ pose, robe });
  const scene = (await composedScene('')) ?? q.get('scene') ?? 'guanyuntai';
  const hour = (q.get('hour') ?? 'night') as Hour;
  const weather = (q.get('weather') ?? 'clear') as Weather;
  await stage.setScene(scene, { hour, weather });
  stage.focus((q.get('focus') ?? 'idle') as FocusPreset);
  if (q.get('covered') === '1') stage.setCovered(true);
  if (q.get('settle') === '1') await stage.fx('settle', {});
  const main = await recipeFrom(q.get('recipe'), loadKit);
  if (main) void stage.portrait((q.get('slot') ?? 'main') as PortraitSlot, main);
  const side = await recipeFrom(q.get('side'), loadKit);
  if (side) void stage.portrait('side', side);
  const speaker = q.get('speaker');
  if (speaker === 'main' || speaker === 'side') void stage.fx('speaker', { slot: speaker });
  const veil = q.get('veil');
  if (veil === '1') stage.veil(readingVeil(canvas.clientWidth, canvas.clientHeight));
  else if (veil) {
    const [x = 0, y = 0, w = 0, h = 0] = veil.split(',').map(Number);
    stage.veil({ x, y, w, h });
  }
  const fx = q.get('fx');
  if (fx === 'cultivate') void stage.fx('cultivate', { seconds: Number(q.get('fxs') ?? 30) });
  else if (fx === 'breakthrough' || fx === 'breakthrough-fail') void stage.fx('breakthrough', { success: fx === 'breakthrough' });
  else if (fx === 'sword') void stage.fx('sword', {});
  else if (fx === 'check') void stage.fx('check', { outcome: (q.get('outcome') ?? 'success') as 'success' });
  else if (fx === 'reset') void stage.fx('reset', {});
  // a change after the first scene: drawn first, then changed
  if (q.has('scene2') || q.has('hour2') || q.has('weather2') || q.has('compose2')) {
    await stage.ready();
    await stage.setScene((await composedScene('2')) ?? q.get('scene2') ?? scene, {
      hour: (q.get('hour2') ?? hour) as Hour,
      weather: (q.get('weather2') ?? weather) as Weather,
    });
  }
  await stage.ready();
  const p = probe();
  Object.assign(report, { stage: canvas.dataset.stage, webgl2: p.webgl2, hdr: p.hdr, renderer: p.renderer });
  report.size = [canvas.clientWidth, canvas.clientHeight, devicePixelRatio];
  const perf = Number(q.get('perf') ?? 0);
  if (perf > 0) report.perf = await measure(perf, stage);
  window.__ready = true;
}

// ---------------------------------------------------------------- composed scenes

const sceneKits = new Map<string, Promise<KitFile>>();

// The scene composed for the place the address names, handed to the stage whole (`n`: '' for the first scene, '2'
// for the change), or null without compose=.
async function composedScene(n: string): Promise<SceneSpec | null> {
  const kitId = q.get(`compose${n}`);
  if (!kitId) return null;
  if (!sceneKits.has(kitId)) sceneKits.set(kitId, loadSceneKit(`${ASSETS}scenes/${kitId}/kit.json`));
  const kit = await sceneKits.get(kitId)!;
  const name = q.get(`place${n}`) ?? '回潮渡';
  const kind = q.get(`kind${n}`);
  const look = q.get(`look${n}`);
  const place = {
    id: q.get(`pid${n}`) ?? name, name, region: q.get(`region${n}`) ?? undefined, description: q.get(`desc${n}`) ?? undefined,
    ...(kind ? { kind } : {}), ...(look ? { look: JSON.parse(look) as PlaceLook } : {}),
  };
  const seed = q.get(`cseed${n}`);
  const c = compose(kit, place, seed ? { seed } : {});
  // where the name is on the screen under the view asked for (the review crops the plaques with it)
  const aspect = innerWidth / Math.max(1, innerHeight);
  const pair = (c.scene.cameras as unknown as Record<string, { wide: Cam; tall: Cam }>)[q.get('focus') ?? 'idle'];
  const cam = pair?.[aspect >= 0.82 ? 'wide' : 'tall'];
  const plaqueScreens = cam ? c.plaqueBoxes.map((box) => screenBox(cam, aspect, box)) : [];
  report.compose = {
    ...report.compose,
    [`scene${n || '1'}`]: {
      id: c.scene.id, picks: c.picks, pieces: c.pieces, files: c.files, bytes: c.bytes, rejected: c.rejected, plaqueScreens,
    },
  };
  return { file: c.scene, folder: `${ASSETS}scenes/${kit.id}/`, plaques: c.plaques };
}

// ---------------------------------------------------------------- the kit's identity with kit.js

interface ReferenceKit {
  compose(recipe: Recipe, scale?: number): Promise<HTMLCanvasElement>;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`no ${src}`));
    document.head.appendChild(s);
  });
}

function pixels(c: HTMLCanvasElement): Uint8ClampedArray {
  return c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
}

async function runKitCheck(): Promise<void> {
  const url = `${ASSETS}portrait-kit/manifest.json`;
  await loadScript(`${ASSETS}portrait-kit/kit.js`);
  const Reference = window.PortraitKit as { load(url: string): Promise<ReferenceKit> };
  const ref = await Reference.load(url);
  const kit = await PortraitKit.load(url);
  const jobs: { recipe: Recipe; scale: number }[] = [{ recipe: PRESETS.elder!, scale: 1 }, { recipe: PRESETS.fox!, scale: 1 }];
  for (const base of Object.keys(kit.manifest.bases)) {
    const first = kit.random(`identity:${base}:1`, { base });
    const second = kit.random(`identity:${base}:2`, { base });
    // the second one always recoloured, so every tint table is exercised
    const tints = kit.tints(base, second.hair);
    second.tint = tints[base.length % tints.length];
    second.tilt = -(second.tilt ?? 2);
    jobs.push({ recipe: first, scale: 1 }, { recipe: second, scale: 0.5 });
  }
  const rows: Record<string, unknown>[] = [];
  let identical = 0;
  for (const [n, job] of jobs.entries()) {
    // alternate who draws first, so the order cannot matter
    const [a, b] = n % 2
      ? [await kit.compose(job.recipe, job.scale), await ref.compose(job.recipe, job.scale)].reverse()
      : [await ref.compose(job.recipe, job.scale), await kit.compose(job.recipe, job.scale)];
    const pa = pixels(a!);
    const pb = pixels(b!);
    let differ = 0;
    let worst = 0;
    let opaque = 0;
    for (let i = 0; i < pa.length; i++) {
      const d = Math.abs(pa[i]! - pb[i]!);
      if (d) differ++;
      if (d > worst) worst = d;
      if (i % 4 === 3 && pa[i]) opaque++;
    }
    const same = a!.width === b!.width && a!.height === b!.height && differ === 0;
    if (same) identical++;
    rows.push({ recipe: job.recipe, scale: job.scale, size: [a!.width, a!.height], opaque, differ, worst, same });
  }
  report.kit = { recipes: jobs.length, bases: new Set(jobs.map((j) => j.recipe.base)).size, identical, rows };
  window.__ready = true;
}

// ---------------------------------------------------------------- the robe table

// The main colour of every body picture in the kit, as the stage would measure it (hero.ts mainColour), so the
// protagonist's robe can be coloured without downloading the body picture (assets/protagonist/protagonist.json).
async function runRobes(): Promise<void> {
  const kit = await PortraitKit.load(`${ASSETS}portrait-kit/manifest.json`);
  const robes: Record<string, [number, number, number]> = {};
  for (const base of Object.values(kit.manifest.bases)) {
    for (const body of base.bodies) {
      const rgb = mainColour(await kit.image(body.file));
      robes[body.file] = rgb.map((v) => Math.round(v * 1000) / 1000) as [number, number, number];
    }
  }
  report.robes = Object.fromEntries(Object.entries(robes).sort(([a], [b]) => (a < b ? -1 : 1)));
  window.__ready = true;
}

const mode = q.get('kit') === 'check' ? runKitCheck : q.get('robes') === '1' ? runRobes : runStage;
mode().catch((error: unknown) => {
  report.errors.push(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
  window.__ready = true;
});
