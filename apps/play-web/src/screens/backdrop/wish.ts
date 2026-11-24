// What the stage behind the title, the saves and the creation shows (spec 七, 标题页: the best scene at the
// idle camera, swaying slowly). One stage serves the three screens, so going from one to another never
// reloads the picture; each screen says what it wants and the backdrop shows it.
import { create } from 'zustand';
import type { Recipe, SaveSummary } from '../../contracts';
import { pins } from '../../lib/params';
import type { FocusPreset, Hour, VeilRect, Weather } from '../../stage';

/** The best scene of all (the prototype's own): the cloud terrace. */
export const TITLE_SCENE = 'guanyuntai';

export interface BackdropWish {
  scene: string;
  hour: Hour;
  weather: Weather;
  focus: FocusPreset;
  /** 0 sways freely (the title), 1 quiets the camera (pages to read) */
  still: number;
  /** the protagonist's back view: a save's or the one being made; absent, the stage's own figure */
  protagonist?: Recipe;
  /** the part of the picture under a page's words, softened and darkened */
  veil: VeilRect | null;
}

export const TITLE_WISH: BackdropWish = {
  scene: TITLE_SCENE,
  hour: 'night',
  weather: 'clear',
  focus: 'idle',
  still: 0,
  veil: null,
};

interface BackdropStore {
  wish: BackdropWish;
  /** true once the stage has drawn the latest wish (screenshots wait for it) */
  drawn: boolean;
  want: (change: Partial<BackdropWish>) => void;
  setDrawn: (drawn: boolean) => void;
}

export const useBackdrop = create<BackdropStore>()((set) => ({
  wish: TITLE_WISH,
  drawn: false,
  want: (change) =>
    set((s) => {
      const next = { ...s.wish, ...change };
      return JSON.stringify(next) === JSON.stringify(s.wish) ? s : { wish: next, drawn: false };
    }),
  setDrawn: (drawn) => set({ drawn }),
}));

const HOURS: Record<string, Hour> = {
  子: 'night',
  丑: 'night',
  寅: 'night',
  卯: 'dawn',
  辰: 'day',
  巳: 'day',
  午: 'day',
  未: 'day',
  申: 'day',
  酉: 'dusk',
  戌: 'night',
  亥: 'night',
};

/** The hour of a time name such as 子时 (spec 九, 时辰); night when it names none. */
export function hourOf(hourName: string | undefined): Hour {
  return HOURS[(hourName ?? '').trim()[0] ?? ''] ?? 'night';
}

/** The save played last: the one 继续 goes on with. */
export function latestSave(saves: readonly SaveSummary[]): SaveSummary | undefined {
  let latest: SaveSummary | undefined;
  for (const save of saves) {
    if (!latest || Date.parse(save.lastPlayedAt) > Date.parse(latest.lastPlayedAt)) latest = save;
  }
  return latest;
}

/**
 * The hour the title shows: where the save to go on with stands, so its colours match; night without one.
 * Screenshots force it with ?light=day (daytime) or ?light=night.
 */
export function titleHour(save: SaveSummary | undefined): Hour {
  const light = pins().light;
  if (light === 'day') return 'day';
  if (light === 'night') return 'night';
  return save ? hourOf(save.hourName) : 'night';
}
