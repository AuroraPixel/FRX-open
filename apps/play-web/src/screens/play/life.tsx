// The cultivation life's rows on the book page (修仙人生, gameplay plan items 10 and 13): the action cards
// at the end of a beat, the annals lines of the days the engine settled, and how a run of such days
// reads as one strand. The page says what the rows may do through LifeContext; without it (the novel's
// saves, the gallery) the rows only show.
import { createContext, useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ActionCard, ActionsBlock, Block, ChronicleBlock, PerkChoice, PerksBlock } from '../../contracts';
import { chineseNumber } from '../../lib/numerals';
import { Acts } from '../../ui/Acts';
import { Annals } from '../../ui/Annals';
import { Dialog } from '../../ui/Dialog';
import { Perks } from '../../ui/Perks';

export interface LifeReading {
  /** the turn whose action cards can be picked: the last one finished, while no turn is under way */
  actsFor: number | null;
  onAct: (card: ActionCard) => void;
  /** a turn is being written or waits, or the save cannot go on: nothing is sent */
  locked: boolean;
  /** keys 1 to 5 pick a card (no panel, close-up or dialog holds the page) */
  hotkeys: boolean;
  /** 写一段 on the newest annals line: the model writes those days out; absent in a scene */
  onElaborate?: (turnNo: number) => void;
  /** a 悟得 chosen, by its index (verb perk) */
  onPerk?: (index: number) => void;
}

export const LifeContext = createContext<LifeReading | null>(null);

/** A beat's action cards: shown, and pressed, only at the end of the turn being read. */
export function LifeActs({ block, no }: { block: ActionsBlock; no: number | undefined }) {
  const life = useContext(LifeContext);
  // the cards of a turn gone by were answered (and those of a turn being written come with its end)
  if (!life || no === undefined || life.actsFor !== no) return null;
  return (
    <Acts
      items={block.items}
      fallback={block.fallback}
      onPick={life.onAct}
      disabled={life.locked}
      hotkeys={life.hotkeys && !life.locked}
    />
  );
}

/** The 悟得 on offer after a gate: pressed, one asks first; confirmed, it is sent. Only the turn being read's. */
export function LifePerks({ block, no }: { block: PerksBlock; no: number | undefined }) {
  const life = useContext(LifeContext);
  const [asked, setAsked] = useState<PerkChoice | null>(null);
  if (!life?.onPerk || no === undefined || life.actsFor !== no) return null;
  const choose = (item: PerkChoice) => {
    setAsked(null);
    life.onPerk?.(item.index);
  };
  return (
    <>
      <Perks items={block.items} onPick={setAsked} disabled={life.locked} />
      {/* over the whole screen: the book's column (a card floating up) would hold a fixed layer inside itself */}
      {createPortal(
        <Dialog
          open={asked !== null}
          title={`悟得「${asked?.name ?? ''}」`}
          confirmLabel="就是它"
          cancelLabel="再想想"
          focusConfirm
          onConfirm={() => asked && choose(asked)}
          onCancel={() => setAsked(null)}
        >
          <p>
            {asked?.text}。三条只能选一条，选定了就不能换。
          </p>
        </Dialog>,
        document.body,
      )}
    </>
  );
}

/** An annals line; the newest one offers 写一段. */
export function LifeAnnal({ block, no }: { block: ChronicleBlock; no: number | undefined }) {
  const life = useContext(LifeContext);
  const elaborate = life?.onElaborate;
  return (
    <Annals
      lines={[{ id: block.id, date: block.date, text: block.text, now: block.now, ...(block.clock ? { clock: block.clock } : {}) }]}
      onElaborate={elaborate && no !== undefined ? () => elaborate(no) : undefined}
      elaborateOff={life?.locked}
    />
  );
}

/** The action cards a turn ends with, if any. */
export function actsOf(blocks: readonly Block[]): ActionsBlock | undefined {
  const cards = blocks.find((block) => block.type === 'actions');
  return cards?.type === 'actions' ? cards : undefined;
}

/** The 悟得 a turn offers, if any. */
export function perksOf(blocks: readonly Block[]): PerksBlock | undefined {
  const perks = blocks.find((block) => block.type === 'perks');
  return perks?.type === 'perks' ? perks : undefined;
}

// the book's own pages (章回, item 38) stand apart too: a turn with one is no quiet annals line
const STORY = new Set<Block['type']>(['narration', 'speech', 'mark', 'actions', 'perks', 'options', 'death', 'volume', 'emerge']);

/**
 * A turn of days the engine settled alone (a standing command, no model): its annals line first and no
 * words of a story after it. A run of them reads as one strand of the annals.
 */
export function annalTurn(blocks: readonly Block[]): boolean {
  return blocks[0]?.type === 'chronicle' && !blocks.some((block) => STORY.has(block.type));
}

export interface AnnalPlace {
  /** an annals turn right after another: no chapter rule of its own, its line on the same strand */
  joined: boolean;
  /** an annals turn another follows: its line says what its cards said, so they are left out */
  folded: boolean;
}

/**
 * Where each annals turn of the page stands in its run, by turn number (the others are left out). The
 * turns come in order, each saying whether it is one (annalTurn, or a command's turn whose line is on
 * its way).
 */
export function annalRuns(turns: readonly { no: number; annal: boolean }[]): Map<number, AnnalPlace> {
  const out = new Map<number, AnnalPlace>();
  turns.forEach((turn, at) => {
    if (!turn.annal) return;
    out.set(turn.no, { joined: Boolean(turns[at - 1]?.annal), folded: Boolean(turns[at + 1]?.annal) });
  });
  return out;
}

/** An age as the corner writes it: 27 → 廿七岁, 30 → 三十岁, 105 → 一百零五岁. */
export function ageWords(age: number): string {
  const value = Math.max(0, Math.floor(age));
  if (value > 20 && value < 30) return `廿${chineseNumber(value - 20)}岁`;
  return `${chineseNumber(value)}岁`;
}

/** The corner's age and lifespan: { age: 廿七岁, lifespan: 寿元一百 } (written 「廿七岁 · 寿元一百」). */
export function lifeWords(age?: number, lifespan?: number): { age?: string; lifespan?: string } {
  return {
    ...(age !== undefined ? { age: ageWords(age) } : {}),
    ...(lifespan !== undefined ? { lifespan: `寿元${chineseNumber(lifespan)}` } : {}),
  };
}
