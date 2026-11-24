// Who stands on the stage (spec 六): at most two people. The first to come stands on the right (the
// main place), the second a step behind on the left (the side place). When the other one speaks the
// two trade brightness, never places; a third person takes the place of the one who spoke longer
// ago. The player is the figure in the scene and never stands here.
import type { Block } from '../../contracts';

export type CastSlot = 'main' | 'side';

export interface Cast {
  main: string | null;
  side: string | null;
  /** whose turn it is to be brighter */
  speaker: CastSlot;
}

export const NOBODY: Cast = { main: null, side: null, speaker: 'main' };

/** Someone speaks or comes on: they take a free place, or the place of the one not speaking now. */
export function step(cast: Cast, id: string): Cast {
  if (cast.main === id) return { ...cast, speaker: 'main' };
  if (cast.side === id) return { ...cast, speaker: 'side' };
  if (!cast.main) return { ...cast, main: id, speaker: 'main' };
  if (!cast.side) return { ...cast, side: id, speaker: 'side' };
  const slot: CastSlot = cast.speaker === 'main' ? 'side' : 'main';
  return slot === 'main' ? { ...cast, main: id, speaker: 'main' } : { ...cast, side: id, speaker: 'side' };
}

/** Only those still here stay; a figure left alone on the side moves to the main place. */
export function keep(cast: Cast, here: (id: string) => boolean): Cast {
  let main = cast.main && here(cast.main) ? cast.main : null;
  let side = cast.side && here(cast.side) ? cast.side : null;
  let speaker = cast.speaker;
  if (!main && side) {
    main = side;
    side = null;
    speaker = 'main';
  }
  if (speaker === 'side' && !side) speaker = 'main';
  if (main === cast.main && side === cast.side && speaker === cast.speaker) return cast;
  return { main, side, speaker };
}

/** The person a block brings forward: someone else speaking, or someone coming on. */
export function actorOf(block: Block): string | null {
  if (block.type === 'speech') return block.speaker.self ? null : (block.speaker.charId ?? null);
  if (block.type === 'enter') return block.charId;
  return null;
}

/**
 * The cast once a turn is over: those no longer present leave, everyone present who spoke or came on
 * in the turn steps forward in order, and whoever else is present fills a free place.
 */
export function settle(before: Cast, blocks: readonly Block[], present: readonly string[]): Cast {
  const here = (id: string) => present.includes(id);
  let cast = keep(before, here);
  for (const block of blocks) {
    const id = actorOf(block);
    if (id && here(id)) cast = step(cast, id);
  }
  const speaker = cast.speaker;
  for (const id of present) {
    if (cast.main && cast.side) break;
    if (id !== cast.main && id !== cast.side) cast = { ...step(cast, id), speaker: cast.main ? speaker : 'main' };
  }
  return cast;
}
