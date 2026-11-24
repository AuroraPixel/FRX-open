// A turn the book is asked to bring up (目录, gameplay plan item 38): the contents ask for it by its
// number; the play page fetches the earlier pages it needs, brings its top up to the top of the text
// and forgets the ask.
import { create } from 'zustand';

export interface JumpStore {
  /** the turn asked for, by number; null when none is */
  to: number | null;
  jump: (turn: number) => void;
  done: () => void;
}

export const useJumpStore = create<JumpStore>()((set) => ({
  to: null,
  jump: (turn) => set({ to: turn }),
  done: () => set({ to: null }),
}));

/**
 * Where a turn asked for stands among the turns fetched (by number, in order): the turn itself, or
 * the first one after it when it is not there (it was taken back); undefined while earlier pages may
 * still hold it. `more`: earlier pages remain.
 */
export function jumpTarget(turns: readonly { no: number }[], to: number, more: boolean): number | null | undefined {
  if (turns.some((turn) => turn.no === to)) return to;
  const first = turns[0]?.no;
  if (more && (first === undefined || first > to)) return undefined;
  return turns.find((turn) => turn.no > to)?.no ?? turns[turns.length - 1]?.no ?? null;
}
