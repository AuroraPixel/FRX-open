// What the latest turn or panel action moved on the main line and the next gate (the owner's second
// playtest: after a scene closed at 白苇集潮契楼 the 主线 and 下一关 cards stood whole over 接下来 although
// nothing on them had changed, and the way on from the scene was lost under them). The cards show whole
// only when that turn moved them; otherwise each folds to one line under 接下来 (NextLine). With no view
// before (a load, 撤回) nothing has moved.
import type { StateView } from '../../contracts';

/** A chapter turned, a condition of it met, or a main line begun. */
export function mainlineMoved(before: StateView | null, after: StateView | null): boolean {
  const now = after?.mainline;
  if (!before || !now) return false;
  const was = before.mainline;
  if (!was) return true;
  if (was.chapter !== now.chapter) return true;
  const met = new Set(was.clues.filter((clue) => clue.done).map((clue) => clue.text));
  return now.clues.some((clue) => clue.done && !met.has(clue.text));
}

/** A lack's kind, its numbers aside: 「修为差 4」 and 「修为差 1」 are one lack, not a new one. */
export const lackKind = (lack: string): string => lack.replace(/\d+(?:\.\d+)?/g, '#');

/** A new gate, its odds changed, or a lack it did not have. */
export function gateMoved(before: StateView | null, after: StateView | null): boolean {
  const now = after?.play?.gate;
  if (!before || !now) return false;
  const was = before.play?.gate;
  if (!was) return true;
  if (was.name !== now.name || was.odds !== now.odds) return true;
  const had = new Set(was.missing.map(lackKind));
  return now.missing.some((lack) => !had.has(lackKind(lack)));
}
