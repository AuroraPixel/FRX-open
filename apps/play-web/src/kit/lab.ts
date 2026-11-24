/* The portrait kit's identity with kit.js for recipes that wear traits (kit-lab.html, development only).

   Both kits compose the same recipes in the same page; the canvases must match byte for byte. kit.js takes trait part
   ids (`traits`), the TypeScript kit trait kinds (`trait`), so each recipe is handed to kit.js with its kinds resolved
   by the manifest. Covered: every adult base, all three trait layers (back, skin, over), traits in the hair tint from
   both colour tables, long hair split behind the body with a tail behind both, tilts both ways, scale 1 and 0.5, kinds
   a base lacks (dropped by the TypeScript kit, never handed to kit.js).

   tools/kit-check.mjs opens /play/kit-lab.html in headless Chrome and reads window.__report; ?show=1 also draws the
   composed portraits side by side. */
import type { Recipe } from '../contracts';
import { PortraitKit } from './kit';

interface ReferenceKit {
  compose(recipe: Record<string, unknown>, scale?: number): Promise<HTMLCanvasElement>;
}

interface Row {
  recipe: Recipe;
  traits: string[];
  scale: number;
  size: [number, number];
  opaque: number;
  differ: number;
  worst: number;
  same: boolean;
}

interface Report {
  errors: string[];
  kit?: { recipes: number; bases: number; identical: number; withTraits: number; rows: Row[] };
}

// what the page leaves for tools/kit-check.mjs (the stage lab declares its own window fields)
const page = window as unknown as { __ready?: boolean; __report?: Report; PortraitKit?: unknown };
const q = new URLSearchParams(location.search);
const ASSETS = q.get('assets') ?? '/play/assets/';
const report: Report = { errors: [] };
page.__report = report;
addEventListener('error', (e) => report.errors.push(String(e.message)));
addEventListener('unhandledrejection', (e) => report.errors.push(String(e.reason)));

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

/** The recipes: two per adult base, then the corners (long hair with a tail, white-painted traits, a child). */
function recipes(kit: PortraitKit): { recipe: Recipe; scale: number }[] {
  const jobs: { recipe: Recipe; scale: number }[] = [];
  const adults = Object.keys(kit.manifest.bases).filter((base) => kit.traitKinds(base).length > 0);
  for (const [n, base] of adults.entries()) {
    const kinds = kit.traitKinds(base);
    // everything the base has at once, in a tint the trait table knows
    const all = kit.random(`identity-trait:${base}:1`, { base, traits: kinds });
    const tints = kit.tints(base, all.hair);
    all.tint = tints[n % tints.length];
    jobs.push({ recipe: all, scale: 1 });
    // two traits from different layers, as painted, half size, the head turned the other way
    const pairs = [['cat-ears', 'scales'], ['horns', 'mark'], ['antlers', 'scales'], ['fox-ears', 'mark']];
    const two = kit.random(`identity-trait:${base}:2`, { base, traits: pairs[n % pairs.length] });
    delete two.tint;
    two.tilt = -(two.tilt ?? 2);
    jobs.push({ recipe: two, scale: 0.5 });
  }
  // long hair split behind the body, a tail behind both, the tail and ears in a tint
  const young = kit.manifest.bases['f-young']!;
  const long = young.hair.find((h) => h.layer === 'split');
  if (long) {
    jobs.push({
      recipe: { base: 'f-young', face: young.faces[3]!.id, hair: long.id, body: young.bodies[2]!.id, tint: 'chestnut', tilt: 3, trait: ['fox-tail', 'fox-ears'] },
      scale: 1,
    });
  }
  // the old bases' traits are painted white: their tint comes from the light table
  const old = kit.manifest.bases['f-old']!;
  const white = old.hair.find((h) => h.colour === 'white') ?? old.hair[0]!;
  jobs.push({
    recipe: { base: 'f-old', face: old.faces[1]!.id, hair: white.id, body: old.bodies[1]!.id, tint: kit.tints('f-old', white.id)[0], tilt: -2, trait: ['cat-ears', 'mark'] },
    scale: 0.5,
  });
  // kinds a base lacks: a fox tail on an old man, anything on a child, a word the kit does not know
  jobs.push({ recipe: { ...kit.random('identity-trait:old-tail', { base: 'm-old' }), trait: ['fox-tail', 'horns', 'wings'] }, scale: 1 });
  jobs.push({ recipe: { ...kit.random('identity-trait:child', { base: 'm-child' }), trait: ['fox-ears'] }, scale: 0.5 });
  return jobs;
}

function show(row: Row, a: HTMLCanvasElement, b: HTMLCanvasElement): void {
  const sheet = document.getElementById('sheet');
  if (!sheet) return;
  for (const [canvas, who] of [[a, 'kit.js'], [b, 'kit.ts']] as const) {
    const figure = document.createElement('figure');
    figure.append(canvas);
    const caption = document.createElement('figcaption');
    caption.textContent = `${who} ${row.recipe.base} ${row.traits.join(',') || '—'} ${row.same ? '相同' : `差 ${row.differ}`}`;
    figure.append(caption);
    sheet.append(figure);
  }
}

async function run(): Promise<void> {
  const url = `${ASSETS}portrait-kit/manifest.json`;
  await loadScript(`${ASSETS}portrait-kit/kit.js`);
  const Reference = page.PortraitKit as { load(url: string): Promise<ReferenceKit> };
  const ref = await Reference.load(url);
  const kit = await PortraitKit.load(url);
  const rows: Row[] = [];
  let identical = 0;
  for (const [n, job] of recipes(kit).entries()) {
    const { trait, ...plain } = job.recipe;
    const traits = kit.traitIds(job.recipe.base, trait ?? []);
    const old = traits.length ? { ...plain, traits } : plain;
    // alternate who draws first, so the order cannot matter
    const [a, b] =
      n % 2
        ? [await kit.compose(job.recipe, job.scale), await ref.compose(old, job.scale)].reverse()
        : [await ref.compose(old, job.scale), await kit.compose(job.recipe, job.scale)];
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
    const same = a!.width === b!.width && a!.height === b!.height && pa.length === pb.length && differ === 0;
    if (same) identical++;
    const row: Row = { recipe: job.recipe, traits, scale: job.scale, size: [a!.width, a!.height], opaque, differ, worst, same };
    rows.push(row);
    if (q.get('show')) show(row, a!, b!);
  }
  report.kit = {
    recipes: rows.length,
    bases: new Set(rows.map((r) => r.recipe.base)).size,
    identical,
    withTraits: rows.filter((r) => r.traits.length > 0).length,
    rows,
  };
  page.__ready = true;
}

run().catch((error: unknown) => {
  report.errors.push(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
  page.__ready = true;
});
