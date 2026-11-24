// The action queue (plan 设计 · 行动队列; spec 三, 行动签). Actions that touch the story (use an item,
// give one away, travel, a deed offered by the daily paper) do not run at once: they wait above the
// input as chips and go out with the next turn, and the server writes them into the player's input
// the way the old page's 行为指令集 did. Panels add chips; the play screen shows them, lets the
// player take one back, and hands them all to the turn being sent. A chip with a note was queued by
// the server (a spirit beast's evolution after feeding): the note is the line the model gets.
import { create } from 'zustand';
import type { QueueItem } from '../contracts';

export interface QueueStore {
  items: QueueItem[];
  /**
   * Adds a chip. One chip per used item, one journey and one note per beast: using the same item
   * again, choosing another destination or the same beast evolving again replaces that chip in place
   * (the caller sets the new count and words).
   * Returns false, changing nothing, when an identical chip is already waiting.
   */
  add: (item: QueueItem) => boolean;
  remove: (index: number) => void;
  clear: () => void;
  /** Hands the chips to the turn being sent and empties the queue. */
  take: () => QueueItem[];
  /** Puts chips back in front, when the server refused the turn before taking them. */
  restore: (items: QueueItem[]) => void;
  /**
   * Takes chips given back (restore) out again for the turn that goes after all (重试 of a refused turn):
   * those of them still waiting, in the queue's order; one taken back meanwhile stays back, and one added
   * since waits for the next turn.
   */
  reclaim: (items: QueueItem[]) => QueueItem[];
}

function same(a: QueueItem, b: QueueItem): boolean {
  return (
    a.kind === b.kind &&
    a.text === b.text &&
    a.itemId === b.itemId &&
    a.charId === b.charId &&
    a.placeId === b.placeId &&
    (a.quantity ?? 1) === (b.quantity ?? 1) &&
    Boolean(a.silent) === Boolean(b.silent) &&
    a.note === b.note
  );
}

/**
 * What a note is about: its first line, which names the beast and its id. The old page kept one
 * evolution line per beast, the latest.
 */
function noteKey(item: QueueItem): string | null {
  return item.kind === 'other' && item.note ? (item.note.split('\n')[0] ?? null) : null;
}

/** The chip a new one takes the place of: the same item used, any earlier journey, the same beast's note. */
function slotOf(items: QueueItem[], item: QueueItem): number {
  if (item.kind === 'use' && item.itemId) return items.findIndex((i) => i.kind === 'use' && i.itemId === item.itemId);
  if (item.kind === 'travel') return items.findIndex((i) => i.kind === 'travel');
  const key = noteKey(item);
  if (key !== null) return items.findIndex((i) => noteKey(i) === key);
  return -1;
}

export const useQueueStore = create<QueueStore>()((set, get) => ({
  items: [],
  add(item) {
    const items = get().items;
    if (items.some((i) => same(i, item))) return false;
    const at = slotOf(items, item);
    set({ items: at < 0 ? [...items, item] : items.map((i, n) => (n === at ? item : i)) });
    return true;
  },
  remove(index) {
    set((s) => ({ items: s.items.filter((_, n) => n !== index) }));
  },
  clear() {
    set({ items: [] });
  },
  take() {
    const items = get().items;
    set({ items: [] });
    return items;
  },
  restore(items) {
    set((s) => ({ items: [...items, ...s.items.filter((i) => !items.some((r) => same(r, i)))] }));
  },
  reclaim(items) {
    const ours = (item: QueueItem) => items.some((r) => same(r, item));
    const taken = get().items.filter(ours);
    set((s) => ({ items: s.items.filter((item) => !ours(item)) }));
    return taken;
  },
}));
