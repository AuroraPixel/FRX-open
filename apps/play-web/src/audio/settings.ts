// The four volume buses as the player sets them, kept in localStorage. Storage can be missing or
// throw (private windows, blocked site data), so every access is guarded and defaults always work.

export type BusName = 'master' | 'music' | 'ambience' | 'sfx';
export const BUS_NAMES: readonly BusName[] = ['master', 'music', 'ambience', 'sfx'];

export interface BusSetting {
  volume: number;
  on: boolean;
}
export type BusSettings = Record<BusName, BusSetting>;

// Interface spec, section 10: music and ambience sit under the effects.
export const DEFAULT_BUSES: Readonly<BusSettings> = Object.freeze({
  master: { volume: 0.8, on: true },
  music: { volume: 0.5, on: true },
  ambience: { volume: 0.6, on: true },
  sfx: { volume: 0.8, on: true },
});

export const STORAGE_KEY = 'frx.audio.buses';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function copyBuses(settings: Readonly<BusSettings>): BusSettings {
  return {
    master: { ...settings.master },
    music: { ...settings.music },
    ambience: { ...settings.ambience },
    sfx: { ...settings.sfx },
  };
}

export function defaultBuses(): BusSettings {
  return copyBuses(DEFAULT_BUSES);
}

function clampVolume(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function readSetting(raw: unknown, fallback: BusSetting): BusSetting {
  if (typeof raw !== 'object' || raw === null) return { ...fallback };
  const { volume, on } = raw as { volume?: unknown; on?: unknown };
  return {
    volume: typeof volume === 'number' && Number.isFinite(volume) ? clampVolume(volume) : fallback.volume,
    on: typeof on === 'boolean' ? on : fallback.on,
  };
}

/** Saved settings merged over the defaults; anything unreadable falls back to the default. */
export function loadBuses(storage: Store | null = browserStorage()): BusSettings {
  const settings = defaultBuses();
  if (!storage) return settings;
  let raw: unknown;
  try {
    const text = storage.getItem(STORAGE_KEY);
    raw = text === null ? null : JSON.parse(text);
  } catch {
    return settings;
  }
  if (typeof raw !== 'object' || raw === null) return settings;
  for (const name of BUS_NAMES) settings[name] = readSetting((raw as Record<string, unknown>)[name], settings[name]);
  return settings;
}

/** Returns false when the browser would not store them; the settings still apply for this visit. */
export function saveBuses(settings: BusSettings, storage: Store | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

export function withChange(settings: BusSettings, name: BusName, change: Partial<BusSetting>): BusSettings {
  const next = { ...settings, [name]: { ...settings[name] } };
  if (typeof change.volume === 'number' && Number.isFinite(change.volume)) next[name].volume = clampVolume(change.volume);
  if (typeof change.on === 'boolean') next[name].on = change.on;
  return next;
}

/** The gain a bus applies: its volume, or nothing when switched off. */
export function busGain(setting: BusSetting): number {
  return setting.on ? clampVolume(setting.volume) : 0;
}
