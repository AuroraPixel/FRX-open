// What this browser keeps of whoever plays here, and what goes when the player changes (the table in
// docs/play-implementation-guide.md, 本地存的东西). The interface keeps its keys in localStorage under
// frx.play. and frx.audio.; it writes no sessionStorage of its own beyond a notice carried over a reload
// (store/account.ts), no IndexedDB and no Cache Storage. How the page looks and sounds belongs to the
// device and stays; everything else under those names belongs to the player who wrote it and goes when
// they sign out or someone else signs in. A key added later is the player's unless it is named here.

const OURS = ['frx.play.', 'frx.audio.'];

/** The device's preferences: display and motion (store/settings.ts), the sound buses (audio/settings.ts). */
export const DEVICE_KEYS: readonly string[] = ['frx.play.settings', 'frx.audio.buses'];

/** Whose data the player keys hold: the user id of the account last signed in here. */
export const OWNER_KEY = 'frx.play.user';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

function browserStorage(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Whether a key is the player's: one of ours, neither a device preference nor the owner's mark. */
export function isPlayerKey(key: string): boolean {
  return OURS.some((prefix) => key.startsWith(prefix)) && !DEVICE_KEYS.includes(key) && key !== OWNER_KEY;
}

/** Removes the player's keys and returns their names; the device's preferences stay. */
export function forgetPlayerData(storage: Store | null = browserStorage()): string[] {
  if (!storage) return [];
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key !== null && isPlayerKey(key)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
    return keys;
  } catch {
    // blocked site data: nothing was kept to forget
    return [];
  }
}

/** The user the player keys belong to, or null when nobody is named (a fresh browser, after a sign-out). */
export function dataOwner(storage: Store | null = browserStorage()): string | null {
  try {
    return storage?.getItem(OWNER_KEY) ?? null;
  } catch {
    return null;
  }
}

export function setDataOwner(userId: string | null, storage: Store | null = browserStorage()): void {
  try {
    if (userId) storage?.setItem(OWNER_KEY, userId);
    else storage?.removeItem(OWNER_KEY);
  } catch {
    // private windows: the keys are cleared again next time, which only costs a close-up shown twice
  }
}

/**
 * The player keys are about to be read for this user: anything another player (or nobody known) left
 * is cleared first. Returns the keys removed.
 */
export function claimPlayerData(userId: string, storage: Store | null = browserStorage()): string[] {
  if (dataOwner(storage) === userId) return [];
  const removed = forgetPlayerData(storage);
  setDataOwner(userId, storage);
  return removed;
}

/**
 * The keys the old interface (removed) kept in this origin's storage, as its scripts at commit
 * 435bfa8 wrote them: every theater_* key (the daily paper's and the theatre's settings, and
 * theater_apiEndpoint, theater_apiKey and theater_apiModel, which were never mirrored to the server and
 * may hold a key), the theme, the theatre's tabs, and the workshop's personal key and cache.
 */
const OLD_PAGE_PREFIXES: readonly string[] = ['theater_'];
const OLD_PAGE_KEYS: readonly string[] = [
  'CULTIVATION_THEME',
  'CULTIVATION_THEATER_TABS_V2',
  'CULTIVATION_WORKSHOP_KEY_V1',
  'CULTIVATION_WORKSHOP_CACHE_V1',
];

export function isOldPageKey(key: string): boolean {
  return OLD_PAGE_KEYS.includes(key) || OLD_PAGE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Removes what the old interface left in this browser; the interface's own frx. keys stay. Run once as
 * the page starts. Returns the keys removed.
 */
export function forgetOldPage(storage: Store | null = browserStorage()): string[] {
  if (!storage) return [];
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key !== null && isOldPageKey(key)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
    return keys;
  } catch {
    // blocked site data: the old page could not have kept anything either
    return [];
  }
}
