// What a turn being written does besides its words (spec 五 and 六, plan 演出): a page turns as it
// starts; each card lands a quarter of a second after the one before with its seal; a check rolls its
// dice before it is stamped (and the stage flashes); a receipt with an effect, a fight and a journey
// to another place become performances the play screen stages one after another; someone speaking
// steps forward and brightens; someone arriving for the first time gets the close-up. With motion
// off there are no performances: the cards land as they come, with their sounds.
import { useEffect, useRef } from 'react';
import type { Block, EnterBlock, Turn } from '../../contracts';
import type { LiveTurn } from '../../store/merge';
import { diceStarts } from './CheckShow';
import { isBeast } from './foe';
import type { Director } from './director';
import type { Meetings } from './meetings';
import { Rhythm } from './rhythm';
import { actorOf } from './cast';
import { at, buzz, cue, showPin } from './showClock';
import { DICE, type Show, type ShowLevel, keyOf } from './shows';

export interface LiveShowHooks {
  /** someone spoke or walked on */
  onActor: (charId: string) => void;
  /** someone arrives for the first time in this save */
  onMeet: (entry: EnterBlock) => void;
  /** a performance to stage after the ones before it */
  onShow: (show: Show) => void;
  /** stage work a screenshot must wait for */
  settled: (work: Promise<unknown>) => void;
  /** a turn starts to be written (again: a retry keeps its number): forget what its last writing landed */
  onRestart: (no: number) => void;
  /** blocks a reset took back (the story rewritten): their performances are not to be staged */
  onDrop: (keys: readonly string[]) => void;
}

interface Track {
  no: number;
  rhythm: Rhythm;
  seen: Set<string>;
  paged: boolean;
  /** where the player is as the turn's scenes have it: a scene elsewhere is a journey */
  place: string;
  /** where the player was when the turn began */
  start: string;
}

/**
 * The waits of the live turn's cards, for their animations; runs the turn's side effects. The blocks
 * are followed into the finished turn too, since the last of them may arrive together with its end.
 */
export function useLiveShow(
  live: LiveTurn | null,
  lastTurn: Turn | undefined,
  director: Director | null,
  meetings: Meetings,
  place: string,
  level: ShowLevel,
  hooks: LiveShowHooks,
): ReadonlyMap<string, number> | undefined {
  const track = useRef<Track | null>(null);
  const timers = useRef<(() => void)[]>([]);
  const latest = useRef({ director, hooks, meetings, level });
  latest.current = { director, hooks, meetings, level };
  const writing = useRef(false);
  const restarted = useRef<number | null>(null);

  // a turn being written anew starts its show anew: a new turn, a retry or a redo of the same number
  const starts = live?.status === 'streaming' && !writing.current;
  writing.current = live?.status === 'streaming';
  if (live && (!track.current || track.current.no !== live.no || starts)) {
    track.current = { no: live.no, rhythm: new Rhythm(), seen: new Set(), paged: false, place, start: place };
    for (const key of [...diceStarts.keys()]) if (key.startsWith(`${live.no}:`)) diceStarts.delete(key);
    restarted.current = live.no;
  }
  const now = performance.now();
  const waits = live && track.current ? track.current.rhythm.waitsFor(live.blocks, now) : undefined;
  // a check's dice start when its card shows: known while drawing, so the card never shows stamped first
  const current = track.current;
  const drawn = current && (live?.no === current.no ? live.blocks : lastTurn?.no === current.no ? lastTurn.blocks : null);
  if (current && drawn && level !== 'off') {
    for (const block of drawn) {
      const key = keyOf(current.no, block.id);
      if (block.type === 'check' && !diceStarts.has(key)) diceStarts.set(key, now + current.rhythm.wait(block, now));
    }
  }

  useEffect(() => {
    if (restarted.current !== null) {
      latest.current.hooks.onRestart(restarted.current);
      restarted.current = null;
    }
    const turn = track.current;
    if (!turn) return;
    const blocks = live?.no === turn.no ? live.blocks : lastTurn?.no === turn.no ? lastTurn.blocks : null;
    if (!blocks) return;
    // a reset takes blocks back (the story rewritten, a scene told again): forget them, so whatever
    // arrives in their place is shown afresh, and drop the performances they had asked for
    if (live?.no === turn.no) {
      const present = new Set(blocks.map((b) => b.id));
      const gone = [...turn.seen].filter((id) => !present.has(id));
      for (const id of gone) {
        turn.seen.delete(id);
        diceStarts.delete(keyOf(turn.no, id));
      }
      if (gone.length > 0) {
        // the player is where the scenes still told put them (a journey taken back is not taken)
        const scenes = blocks.filter((b) => b.type === 'scene' && turn.seen.has(b.id));
        const last = scenes[scenes.length - 1];
        turn.place = last?.type === 'scene' ? last.place : turn.start;
        latest.current.hooks.onDrop(gone.map((id) => keyOf(turn.no, id)));
      }
    }
    const now = performance.now();
    if (!turn.paged && live?.no === turn.no && live.status === 'streaming') {
      turn.paged = true;
      cue('ui.page');
    }
    const later = (wait: number, act: () => void) => {
      const timer = setTimeout(act, wait);
      timers.current.push(() => clearTimeout(timer));
    };
    for (const block of blocks) {
      if (turn.seen.has(block.id)) continue;
      turn.seen.add(block.id);
      const wait = turn.rhythm.wait(block, now);
      showBlock(block, blocks, turn, wait, now, latest.current, later, (stop) => timers.current.push(stop));
    }
  }, [live, lastTurn]);

  useEffect(
    () => () => {
      for (const stop of timers.current) stop();
      timers.current = [];
    },
    [],
  );

  return waits;
}

interface Context {
  director: Director | null;
  hooks: LiveShowHooks;
  meetings: Meetings;
  level: ShowLevel;
}

function showBlock(
  block: Block,
  blocks: readonly Block[],
  turn: Track,
  wait: number,
  now: number,
  { director, hooks: on, meetings: met, level }: Context,
  later: (wait: number, act: () => void) => void,
  keep: (stop: () => void) => void,
): void {
  const key = keyOf(turn.no, block.id);
  const performing = level !== 'off';
  switch (block.type) {
    case 'check': {
      // the dice roll first; the stamp, its sound and the stage's flash come once they settle
      const stamp = performing ? (level === 'full' ? DICE.full.stamp : DICE.weak.stamp) : 0;
      if (performing) {
        if (!diceStarts.has(key)) diceStarts.set(key, now + wait);
        later(wait, () => cue('fx.dice'));
      }
      const pinned = showPin();
      const stamped = wait / 1000 + stamp;
      keep(
        at(stamped, () => {
          if (pinned === null) {
            cue('ui.seal');
            buzz();
          }
          void director?.fx('check', { outcome: block.outcome, ...(pinned !== null ? { since: Math.max(0, pinned - stamped) } : {}) });
          // a still waits for the flash to be drawn (the effect itself never ends on a stopped clock)
          on.settled(Promise.resolve());
        }),
      );
      break;
    }
    case 'combat':
      if (performing) on.onShow({ kind: 'combat', key, turn: turn.no, blocks: [block] });
      else
        later(wait, () => {
          cue('ui.seal');
          buzz();
        });
      break;
    case 'receipt':
      if (performing && block.fx?.name === 'cultivate') {
        on.onShow({ kind: 'cultivate', key, turn: turn.no, receipt: block, seconds: block.fx.seconds });
      } else if (performing && block.fx?.name === 'breakthrough') {
        on.onShow({ kind: 'breakthrough', key, turn: turn.no, receipt: block, success: block.fx.success, realm: block.fx.realm });
      } else {
        later(wait, () => cue('ui.receipt'));
      }
      break;
    case 'scene':
      if (performing && block.place !== turn.place) {
        on.onShow({ kind: 'travel', key, turn: turn.no, scene: block, line: journeyLine(blocks) });
        turn.place = block.place;
      }
      break;
    case 'enter':
      // a beast the model listed among the people has no portrait to stand in, nor a face to meet
      if (isBeast({ name: block.name, role: block.role })) break;
      if (met.isFirst(block)) on.onMeet(block);
      else on.onActor(block.charId);
      break;
    case 'speech': {
      const id = actorOf(block);
      if (id) on.onActor(id);
      break;
    }
    default:
      break;
  }
}

/** The player's own words for a journey: what they wrote, or the travel chip they sent. */
export function journeyLine(blocks: readonly Block[]): string {
  const action = blocks.find((b) => b.type === 'action');
  if (action?.type !== 'action') return '';
  const text = action.text.trim();
  if (text) return text;
  return action.queue?.find((item) => item.kind === 'travel')?.text ?? '';
}
