// One tab stop for a whole grid of slots (or a table of cells): Tab enters on the picked one, or the
// one last visited, or the first; the arrow keys, Home and End move within; Tab leaves. Without it a
// full bag would take twenty Tabs to get from the first slot to the detail under the grid (spec 十二).
import { type FocusEvent, type KeyboardEvent, useState } from 'react';

type Way = 'left' | 'right' | 'up' | 'down' | 'home' | 'end';

const WAYS: Record<string, Way> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Home: 'home',
  End: 'end',
};

/** The item to go to from `from`, by order for left and right and by where they stand for up and down. */
export function nextItem(items: HTMLElement[], from: number, way: Way): HTMLElement | undefined {
  if (way === 'home') return items[0];
  if (way === 'end') return items[items.length - 1];
  if (way === 'left') return items[from - 1];
  if (way === 'right') return items[from + 1];
  const here = items[from]?.getBoundingClientRect();
  if (!here) return undefined;
  const middle = here.left + here.width / 2;
  const rows = items
    .map((item) => ({ item, box: item.getBoundingClientRect() }))
    .filter(({ box }) => (way === 'down' ? box.top >= here.bottom - 1 : box.bottom <= here.top + 1));
  if (rows.length === 0) return undefined;
  const nearest =
    way === 'down' ? Math.min(...rows.map(({ box }) => box.top)) : Math.max(...rows.map(({ box }) => box.top));
  const row = rows.filter(({ box }) => Math.abs(box.top - nearest) < 2);
  row.sort((a, b) => Math.abs(a.box.left + a.box.width / 2 - middle) - Math.abs(b.box.left + b.box.width / 2 - middle));
  return row[0]?.item;
}

/**
 * Roving focus over the items of one group. Spread `group` on the element holding them and
 * `item(key)` on each item.
 */
export function useRoving(keys: string[], preferred: string | null) {
  const [visited, setVisited] = useState<string | null>(null);
  const current =
    visited !== null && keys.includes(visited)
      ? visited
      : preferred !== null && keys.includes(preferred)
        ? preferred
        : (keys[0] ?? null);
  return {
    group: {
      onKeyDown(event: KeyboardEvent<HTMLElement>) {
        const way = WAYS[event.key];
        if (!way || event.altKey || event.ctrlKey || event.metaKey) return;
        const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-nav]')];
        const from = items.indexOf(document.activeElement as HTMLElement);
        if (from < 0) return;
        event.preventDefault();
        nextItem(items, from, way)?.focus();
      },
    },
    item: (key: string) => ({
      'data-nav': key,
      tabIndex: key === current ? 0 : -1,
      onFocus: (_event: FocusEvent<HTMLElement>) => setVisited(key),
    }),
  };
}
