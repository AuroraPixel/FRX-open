// What the play screen asks of the stage, as hooks: knowing when the stage has drawn what it was
// asked for, who stands on it, and where its veil softens the picture under the words.
import { type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SceneBlock, StateView, Turn } from '../../contracts';
import type { DockStop } from '../../ui/drag';
import type { Light } from '../../store/ui';
import type { LiveTurn } from '../../store/merge';
import { type Cast, settle } from './cast';
import type { Director } from './director';
import { isBeast } from './foe';
import { askRecipe, recipeInView } from './people';

/** How far the picture under the book is softened toward the page colour. */
const VEIL = { desktop: 0.86, strong: 0.9, dusk: 0.92 } as const;

/**
 * Stage work the screenshot tool must wait for: `settled(work)` is told of each piece, `ready` is
 * true once the stage has drawn the latest.
 */
export function useStageSettled(director: Director | null) {
  const asked = useRef(0);
  const [askedToken, setAskedToken] = useState(0);
  const [drawnToken, setDrawnToken] = useState(0);
  const settled = useCallback(
    (work: Promise<unknown>) => {
      if (!director) return;
      asked.current += 1;
      const token = asked.current;
      setAskedToken(token);
      void work
        .catch(() => undefined)
        .then(() => director.ready())
        .then(() => setDrawnToken((t) => Math.max(t, token)));
    },
    [director],
  );
  return { settled, ready: drawnToken >= askedToken };
}

/** The cast at rest: after each finished turn, from who spoke in it and who is present. */
export function useCastAtRest(view: StateView, turns: Turn[], live: LiveTurn | null, setCast: (next: (before: Cast) => Cast) => void) {
  // beasts in the people table stand on no place: they have no portrait (foe.ts isBeast)
  const present = useMemo(() => view.people.filter((p) => p.present && !isBeast(p)).map((p) => p.id), [view]);
  const presentKey = present.join(',');
  const lastTurn = turns[turns.length - 1];
  const streaming = live?.status === 'streaming';
  useEffect(() => {
    if (streaming) return;
    setCast((before) => settle(before, lastTurn?.blocks ?? [], present));
    // the present people change with the view; the key stands for them
  }, [lastTurn, presentKey, streaming, setCast]);
}

/**
 * Puts on the stage whoever stands in each place, with their portrait recipe, and brightens the speaker.
 * `named` gives the name of someone just arrived (the close-up): the model gives an id someone holds to
 * someone new, and until the turn's state arrives the view still lists the one who had it.
 */
export function useStanding(
  director: Director | null,
  saveId: string,
  view: StateView,
  standing: Cast,
  settled: (work: Promise<unknown>) => void,
  named?: { charId: string; name: string } | null,
) {
  const nameOf = (id: string) => (named && named.charId === id ? named.name : undefined);
  const mainName = standing.main ? nameOf(standing.main) : undefined;
  const sideName = standing.side ? nameOf(standing.side) : undefined;
  useEffect(() => {
    if (!director) return;
    let alive = true;
    const place = (slot: 'main' | 'side', id: string | null, name?: string): Promise<void> => {
      if (!id) return director.stand(slot, null);
      const known = recipeInView(view, id, name);
      if (known) return director.stand(slot, known);
      return askRecipe(saveId, id, name).then((recipe) => (alive ? director.stand(slot, recipe) : undefined));
    };
    settled(Promise.all([place('main', standing.main, mainName), place('side', standing.side, sideName)]));
    director.speak(standing.speaker);
    return () => {
      alive = false;
    };
  }, [director, saveId, view, standing.main, standing.side, standing.speaker, mainName, sideName, settled]);
}

export interface VeilPlace {
  /** the close-up is on: its words stand on the picture */
  cine: boolean;
  /** a performance has the whole picture (a breakthrough, a journey): no veil at all */
  bare?: boolean;
  /** a panel is open beside the book (desktops): the book's veil darkens a little more */
  sheet?: boolean;
  phone: boolean;
  dock: DockStop;
  safeTop: number;
  fullTop?: number;
  light: Light;
  /** the hour of the scene: at dusk the sky behind a desktop's book stays bright */
  hour?: SceneBlock['hour'];
  /** changes whenever the page's size or the book's place may have changed */
  tick: unknown;
}

/**
 * The veil under the words: desktops from the left edge to 44 px past the book, phones from 26 px under
 * the book's top. Stronger than the spec's 0.70 / 0.76: over bright clouds and robes those left the
 * faintest captions under 4.5:1 (screenshots measure it); with a panel open the camera turns towards
 * brighter sky, so the veil takes the stronger amount then too, and at dusk the sky behind a desktop's
 * book is the brightest the night colours meet (山门: a speaker's 11.5 px role at 4.16:1 under 0.86). During the close-up it softens the picture
 * under its words instead: the left on desktops, the lower part on phones, away from the face.
 */
export function useVeilUnder(director: Director | null, bookRef: RefObject<HTMLElement | null>, at: VeilPlace) {
  const { cine, bare = false, sheet = false, phone, dock, safeTop, fullTop = 96, light, hour, tick } = at;
  useLayoutEffect(() => {
    if (!director) return;
    if (bare) {
      director.veil(null);
      return;
    }
    if (cine) {
      director.veil(
        phone
          ? { x: -400, y: innerHeight * 0.64, w: innerWidth + 800, h: innerHeight, feather: 160, amount: 0.6 }
          : { x: -400, y: -400, w: innerWidth * 0.46 + 400, h: innerHeight + 800, feather: 260, amount: 0.62 },
      );
      return;
    }
    const book = bookRef.current;
    if (!book) return;
    // a narrow desktop (a tablet, a phone on its side) frames a brighter stretch of the picture behind the
    // book: a speaker's 11.5 px role read 4.42:1 under 0.86 on a tablet at night
    const narrow = !phone && innerWidth < 1100;
    const amount = Math.max(light === 'day' || phone || sheet || narrow ? VEIL.strong : VEIL.desktop, !phone && hour === 'dusk' ? VEIL.dusk : 0);
    if (phone) {
      const top = dock === 'full' ? fullTop + safeTop : innerHeight * 0.41;
      director.veil({ x: -400, y: top + 26, w: innerWidth + 800, h: innerHeight + 400, amount });
    } else {
      director.veil({ x: -400, y: -400, w: book.getBoundingClientRect().right + 44 + 400, h: innerHeight + 800, amount });
    }
  }, [director, bookRef, cine, bare, sheet, phone, dock, safeTop, fullTop, tick, light, hour]);
}

/** The safe area at the top, which CSS knows and script does not: read off a probe. */
export function useSafeTop(probe: RefObject<HTMLElement | null>): number {
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    const measure = () => setTop(probe.current?.offsetHeight ?? 0);
    measure();
    addEventListener('resize', measure);
    return () => removeEventListener('resize', measure);
  }, [probe]);
  return top;
}

/** A number that changes whenever the page is resized. */
export function useViewportTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    addEventListener('resize', bump);
    return () => removeEventListener('resize', bump);
  }, []);
  return tick;
}
