// The pictures the panels show: item icons by an item's `icon` key, beasts by their `species` key
// (docs/play-contracts.md 六, 素材清单). Both lists are runtime assets like the pictures themselves
// (/play/assets/icons/icons.json, /play/assets/bestiary/bestiary.json), fetched once on first use, so
// new art needs no new build. Until they arrive, or if they cannot be had, a slot shows the item's
// brush character and a beast the generic silhouette.
import { useEffect } from 'react';
import { create } from 'zustand';
import type { BestiaryManifest, IconManifest, Item } from '../../contracts';

export const ASSETS = '/play/assets/';

interface ArtLists {
  icons: IconManifest | null;
  bestiary: BestiaryManifest | null;
  /** both fetches have ended, one way or the other */
  settled: boolean;
}

export const useArtLists = create<ArtLists>()(() => ({ icons: null, bestiary: null, settled: false }));

let started: Promise<void> | null = null;

async function fetchList<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(ASSETS + path);
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Starts fetching the two lists (once); the play screen may call it early to have them ready. */
export function loadArtLists(): Promise<void> {
  started ??= Promise.all([
    fetchList<IconManifest>('icons/icons.json'),
    fetchList<BestiaryManifest>('bestiary/bestiary.json'),
  ]).then(([icons, bestiary]) => useArtLists.setState({ icons, bestiary, settled: true }));
  return started;
}

/** Tests hand the lists in directly. */
export function setArtListsForTest(lists: Partial<ArtLists> | null): void {
  started = lists ? Promise.resolve() : null;
  useArtLists.setState(
    lists ? { icons: null, bestiary: null, settled: true, ...lists } : { icons: null, bestiary: null, settled: false },
  );
}

export function useArt(): ArtLists {
  useEffect(() => {
    void loadArtLists();
  }, []);
  return useArtLists();
}

/**
 * The picture for an item: its own icon, else the default icon of its type (the server already
 * falls back that way; this covers keys the list does not know yet), else none and the slot shows a
 * brush character.
 */
export function iconUrl(icons: IconManifest | null, item: Pick<Item, 'icon' | 'type'>): string | undefined {
  if (!icons) return undefined;
  const entry = icons.icons[item.icon] ?? icons.icons[icons.defaults[item.type] ?? ''];
  return entry ? `${ASSETS}icons/${entry.file}` : undefined;
}

export interface BeastPicture {
  url: string;
  /** what the picture shows: 「狐」, or 「妖兽」 for the silhouette */
  label: string;
  /** false: the bestiary has no picture of this species and the silhouette stands in */
  known: boolean;
}

export function beastPicture(bestiary: BestiaryManifest | null, species: string): BeastPicture {
  const own = bestiary?.species[species];
  const entry = own ?? bestiary?.species[bestiary.fallback];
  return {
    url: `${ASSETS}bestiary/${entry?.file ?? 'silhouette.webp'}`,
    label: own?.label ?? '妖兽',
    known: Boolean(own) && species !== bestiary?.fallback,
  };
}
