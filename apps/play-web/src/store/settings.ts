// The player's own display settings, kept in this browser (spec 七, 设置). The sound's four buses keep
// their own (audio/settings.ts, frx.audio.buses); settings that belong to the save or the server (model
// connections, the standing note) live on the server.
import { create } from 'zustand';

export type Motion = 'full' | 'weak' | 'off';
export type Quality = 'auto' | 'high' | 'low';
/** How wide the book page is on desktops (plan item 47, 行宽); phones always span the screen. */
export type Measure = 'narrow' | 'normal' | 'wide';

export interface Settings {
  /** the story's size in px, 15 to 20; null keeps the spec's default (17, 16.5 on phones) */
  fontSize: number | null;
  motion: Motion;
  quality: Quality;
  /** a short vibration for seals and breakthroughs, where the phone allows it */
  haptics: boolean;
  measure: Measure;
}

export const DEFAULTS: Settings = {
  fontSize: null,
  motion: 'full',
  quality: 'auto',
  haptics: true,
  measure: 'normal',
};

/** The book's width on desktops for each measure: the spec's 588 px, a line narrower or wider. */
export const MEASURE_PX: Record<Measure, number> = { narrow: 524, normal: 588, wide: 652 };

/** The system asks for less motion (spec 二, 动效; 十二). */
export function systemReducesMotion(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

/**
 * How fully the performances play (spec 二, 动效; plan 演出): the setting, where the system's own
 * reduced motion turns 'full' into 'weak' — the player may still turn them off.
 */
export function showLevel(motion: Motion, systemReduced: boolean): Motion {
  if (motion === 'off') return 'off';
  return motion === 'weak' || systemReduced ? 'weak' : 'full';
}

const KEY = 'frx.play.settings';

function stored(): Partial<Settings> {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<Settings>) : {};
  } catch {
    return {};
  }
}

function store(settings: Settings): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    // private windows and full storage: the settings last for this visit
  }
}

export function readSettings(): Settings {
  // a volume and a mute of each bus were kept here too, written and never read (the documents pass,
  // #22): the buses' own are read back (audio/settings.ts); an old copy of these goes at the next write
  const { volume: _volume, muted: _muted, ...saved } = stored() as Partial<Settings> & { volume?: unknown; muted?: unknown };
  return {
    ...DEFAULTS,
    // a player who has not chosen gets the performances weak when the system asks for less motion
    // (plan item 71), and sees 「弱」 chosen in the settings
    motion: systemReducesMotion() ? 'weak' : DEFAULTS.motion,
    ...saved,
  };
}

/** Puts the settings that CSS needs on the root element: the story's size and width, the motion level. */
export function applySettings(settings: Settings, root: HTMLElement = document.documentElement): void {
  // the size chosen, and that it was chosen (--read-chosen): a short screen's own 16 px gives way to it
  for (const name of ['--read-size', '--read-chosen']) {
    if (settings.fontSize === null) root.style.removeProperty(name);
    else root.style.setProperty(name, `${Math.min(20, Math.max(15, settings.fontSize))}px`);
  }
  const measure = MEASURE_PX[settings.measure] ?? MEASURE_PX.normal;
  if (measure === MEASURE_PX.normal) root.style.removeProperty('--read-measure');
  else root.style.setProperty('--read-measure', `${measure}px`);
  if (settings.motion === 'full') delete root.dataset.motion;
  else root.dataset.motion = settings.motion;
}

/**
 * What a stage starts with from the settings (the play screen's and the one behind the title, the saves and
 * the creation): the motion level as its level, which stage.motion changes afterwards, and the picture
 * quality, which only a new stage takes. The documents pass (#12, #13): 动效「关」 was passed as the
 * system's reduced motion, which nothing could take back, so the stage stayed still after 动效 went back
 * on; and the stage behind the title, the saves and the creation never took the quality at all.
 */
export function stageStart(): { motion?: Motion; quality?: Quality } {
  const { motion, quality } = useSettingsStore.getState();
  return { ...(motion !== 'full' ? { motion } : {}), ...(quality !== 'auto' ? { quality } : {}) };
}

export interface SettingsStore extends Settings {
  change: (patch: Partial<Settings>) => void;
}

export const useSettingsStore = create<SettingsStore>()((set, get) => ({
  ...readSettings(),
  change(patch) {
    set(patch);
    const { change: _change, ...settings } = get();
    store(settings);
    applySettings(settings);
  },
}));
