// Who the player has already met in a save, so a first-meeting close-up (spec 六) plays once per
// person per save. The server marks an arrival `first` the first time; the page also remembers the
// close-ups it has shown, and everyone who arrived in a turn already in the history counts as met,
// so a turn sent again, retried or replayed never repeats one. Kept in this browser per save.
//
// A person is their id and their name together: the model hands an id that has fallen free to someone
// new (C1 was 孙执事, then 马执事), and the newcomer is a first meeting all the same. Someone who keeps
// their name under a new id is not: the server does not mark that arrival first.
import type { Block } from '../../contracts';

const PREFIX = 'frx.play.met.';

/** Who arrived: the id and the name. */
export interface Arrival {
  charId: string;
  name: string;
}

function who({ charId, name }: Arrival): string {
  return `${charId}·${name}`;
}

function readStored(saveId: string): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(PREFIX + saveId);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export class Meetings {
  private readonly met: Set<string>;

  constructor(readonly saveId: string) {
    this.met = new Set(readStored(saveId));
  }

  /** Everyone who arrived in these turns has been met: they are history now. */
  learn(turns: readonly { blocks: readonly Block[] }[]): void {
    for (const turn of turns) for (const block of turn.blocks) if (block.type === 'enter') this.met.add(who(block));
  }

  /** Whether this arrival is a first meeting that has not been shown yet. */
  isFirst(block: Block): boolean {
    return block.type === 'enter' && block.first && !this.met.has(who(block));
  }

  /** The close-up for this person has been shown: never again in this save. */
  remember(arrival: Arrival): void {
    const key = who(arrival);
    if (this.met.has(key)) return;
    this.met.add(key);
    try {
      globalThis.localStorage?.setItem(PREFIX + this.saveId, JSON.stringify([...this.met].slice(-500)));
    } catch {
      // private windows: remembered for this visit, and the history still counts
    }
  }
}
