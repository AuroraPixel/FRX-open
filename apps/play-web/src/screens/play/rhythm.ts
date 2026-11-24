// How the cards of a turn being written appear (spec 五, 一回合怎么出现): checks and clashes come before
// the first word, receipts after the last, often several at once; they float in one by one, a quarter
// of a second apart, each with its seal. The wait of a card is fixed the first time it is seen, so a
// re-render never moves its animation.
import type { Block } from '../../contracts';

export const CARD_GAP_MS = 250;

const CARDS = new Set<Block['type']>(['check', 'combat', 'receipt']);

function isCard(block: Block): boolean {
  return CARDS.has(block.type);
}

export class Rhythm {
  private next = 0;
  private readonly waits = new Map<string, number>();

  /** How long a block waits before it shows, counted from the moment it was first seen. */
  wait(block: Block, now: number): number {
    let wait = this.waits.get(block.id);
    if (wait === undefined) {
      wait = 0;
      if (isCard(block)) {
        const at = Math.max(now, this.next);
        wait = at - now;
        this.next = at + CARD_GAP_MS;
      }
      this.waits.set(block.id, wait);
    }
    return wait;
  }

  /** The waits of every block so far. */
  waitsFor(blocks: readonly Block[], now: number): Map<string, number> {
    return new Map(blocks.map((block) => [block.id, this.wait(block, now)]));
  }
}
