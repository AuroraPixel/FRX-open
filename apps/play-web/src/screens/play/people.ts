// Portrait recipes for the people of the save being played, and the small round heads cut from them
// for the spoken lines (spec 三, 对白行; implementation guide 五, 立绘). Recipes come from the state
// view; someone it does not list (a person who has left, or one who has just arrived and whom the
// view will only list after the turn) is asked for once with GET …/people/{charId}. The model gives
// an id to someone else over time: an old turn's line asks with the name it gives, so it keeps the
// face of the one who said it. A look changed in the people panel (改形象) is asked for again.
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Recipe, StateView } from '../../contracts';
import { play } from '../../api/client';
import { PortraitKit } from '../../kit/kit';

const KIT_URL = '/play/assets/portrait-kit/manifest.json';
/** The head is drawn into 96 px squares: crisp at 40 px on screens up to 2.4× density. */
const HEAD_PX = 96;
/** Composing at this scale gives the 290 px head box 116 px, a little more than the square. */
const HEAD_SCALE = 0.4;

/** Whether two names are one person's: the same, or one grown out of the other (as the server judges). */
export function sameName(a: string, b: string): boolean {
  return a !== '' && b !== '' && (a.includes(b) || b.includes(a));
}

/**
 * The recipe the state view gives for someone: the player (B1) or a person present. With a name, only
 * when the one the view lists under the id is that person.
 */
export function recipeInView(view: StateView | null, charId: string | undefined, name?: string): Recipe | undefined {
  if (!view || !charId) return undefined;
  if (view.player.id === charId) return view.player.portrait;
  const person = view.people.find((p) => p.id === charId);
  if (!person || (name !== undefined && !sameName(person.name, name))) return undefined;
  return person.portrait;
}

const asked = new Map<string, Promise<Recipe | null>>();
// what was asked changes when a look is changed: the hooks ask again
let round = 0;
const listeners = new Set<() => void>();

function askedKey(saveId: string, charId: string, name?: string): string {
  return `${saveId}/${charId}/${name ?? ''}`;
}

/**
 * Someone the view does not list: their recipe from the person's own page, asked for once per save,
 * with the name an old turn gives them when it gives one. An answer that found nobody is not kept: a
 * newcomer the model gave an old id to is known to the server only once their turn is saved.
 */
export function askRecipe(saveId: string, charId: string, name?: string): Promise<Recipe | null> {
  const key = askedKey(saveId, charId, name);
  let found = asked.get(key);
  if (!found) {
    found = play.person(saveId, charId, name).then(
      (person) => person.portrait ?? null,
      () => {
        asked.delete(key);
        return null;
      },
    );
    asked.set(key, found);
  }
  return found;
}

/**
 * Someone's look was changed (改形象): the new recipe stands for the one who has the id now, at once;
 * whatever else was asked under the id is asked again, and every head and figure drawn from it follows.
 */
export function lookChanged(saveId: string, charId: string, name: string, recipe: Recipe): void {
  const prefix = askedKey(saveId, charId, '');
  for (const key of [...asked.keys()]) if (key.startsWith(prefix)) asked.delete(key);
  asked.set(askedKey(saveId, charId), Promise.resolve(recipe));
  asked.set(askedKey(saveId, charId, name), Promise.resolve(recipe));
  round += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The recipe for someone, from the view at once or from the server when the view does not have them;
 * `name` is the one a turn gives them, so an old turn keeps the face of the one it named.
 */
export function useRecipe(saveId: string, view: StateView | null, charId: string | undefined, name?: string): Recipe | undefined {
  const inView = recipeInView(view, charId, name);
  const asking = useSyncExternalStore(subscribe, () => round, () => round);
  const who = charId ? askedKey(saveId, charId, name) : '';
  const [fetched, setFetched] = useState<{ who: string; recipe: Recipe | null } | null>(null);
  useEffect(() => {
    if (inView || !charId) return;
    let live = true;
    void askRecipe(saveId, charId, name).then((recipe) => live && setFetched({ who, recipe }));
    return () => {
      live = false;
    };
    // `asking` asks again after a look was changed; the last answer stays until the new one comes
  }, [saveId, charId, name, inView, who, asking]);
  if (inView) return inView;
  if (fetched && fetched.who === who) return fetched.recipe ?? undefined;
  return undefined;
}

let kit: Promise<PortraitKit> | null = null;

function loadKit(): Promise<PortraitKit> {
  if (!kit) {
    kit = PortraitKit.load(KIT_URL);
    kit.catch(() => {
      kit = null;
    });
  }
  return kit;
}

const heads = new Map<string, Promise<string | null>>();
const drawn = new Map<string, string>();

/** A small picture of the head, cut from the composed portrait with the kit's head box; cached by recipe. */
export function headOf(recipe: Recipe): Promise<string | null> {
  const key = JSON.stringify(recipe);
  let made = heads.get(key);
  if (!made) {
    made = (async () => {
      const k = await loadKit();
      const figure = await k.compose(recipe, HEAD_SCALE);
      const [x, y, w, h] = k.headBox(recipe);
      const square = document.createElement('canvas');
      square.width = HEAD_PX;
      square.height = HEAD_PX;
      const g = square.getContext('2d');
      if (!g) return null;
      g.imageSmoothingQuality = 'high';
      g.drawImage(figure, x * HEAD_SCALE, y * HEAD_SCALE, w * HEAD_SCALE, h * HEAD_SCALE, 0, 0, HEAD_PX, HEAD_PX);
      const url = square.toDataURL('image/webp', 0.9);
      drawn.set(key, url);
      return url;
    })().catch(() => null);
    heads.set(key, made);
  }
  return made;
}

/**
 * A portrait for someone the save has no character for (a bandit named only in a fight): drawn from
 * the name, so the same name always looks the same; a woman's words make a woman, an elder's an old one.
 */
export async function randomRecipe(seed: string): Promise<Recipe | null> {
  try {
    const k = await loadKit();
    const sex = /[女娘姑婆妃姬妇]/.test(seed) ? 'f' : 'm';
    const age = /[老翁叟]|长老|道人|真人/.test(seed) ? 'old' : /弟子|公子|书生|少年/.test(seed) ? 'young' : 'mid';
    return k.random(seed, { sex, age });
  } catch {
    return null;
  }
}

/** The head picture for a recipe, once it is drawn; undefined until then (the first character stands in). */
export function useHead(recipe: Recipe | undefined): string | undefined {
  const key = recipe ? JSON.stringify(recipe) : '';
  const [url, setUrl] = useState<{ key: string; url: string } | null>(null);
  useEffect(() => {
    if (!recipe || drawn.has(key)) return;
    let live = true;
    void headOf(recipe).then((made) => {
      if (live && made) setUrl({ key, url: made });
    });
    return () => {
      live = false;
    };
    // the key stands for the recipe: a new object with the same parts draws nothing new
  }, [key]);
  return drawn.get(key) ?? (url?.key === key ? url.url : undefined);
}
