// The performances of the play screen (plan 演出): staged one after another, a fight's exchanges joining
// the fight already queued for their turn. Their cards land in the book as they play: until then a
// performed turn holds them back, and a fight's last card waits for its verdict. A turn written anew lands
// its cards anew; blocks a reset took back take their performances with them.
import { useCallback, useMemo, useRef, useState } from 'react';
import type { Turn } from '../../contracts';
import type { LiveTurn } from '../../store/merge';
import { type Show, type ShowLevel, cardsOf, isShowCard, keyOf } from './shows';

export function usePerformances(live: LiveTurn | null, turns: Turn[], level: ShowLevel, settled: (work: Promise<unknown>) => void) {
  const [shows, setShows] = useState<Show[]>([]);
  const [landed, setLanded] = useState<ReadonlySet<string>>(() => new Set());
  const [verdicts, setVerdicts] = useState<ReadonlySet<string>>(() => new Set());
  const [staged, setStaged] = useState<string | null>(null);
  const performed = useRef(new Set<number>());

  // a fight's exchanges join the fight already queued for their turn
  const onShow = useCallback((next: Show) => {
    setShows((queue) => {
      if (queue.some((s) => s.key === next.key)) return queue;
      if (next.kind === 'combat') {
        const at = queue.findIndex((s) => s.kind === 'combat' && s.turn === next.turn);
        const fight = queue[at];
        if (fight?.kind === 'combat') return queue.map((s, i) => (i === at ? { ...fight, blocks: [...fight.blocks, ...next.blocks] } : s));
      }
      return [...queue, next];
    });
  }, []);
  if (live && level !== 'off') performed.current.add(live.no);
  // a turn written anew lands its cards anew
  const onRestart = useCallback((no: number) => {
    const keep = (before: ReadonlySet<string>) => {
      const kept = [...before].filter((key) => !key.startsWith(`${no}:`));
      return kept.length === before.size ? before : new Set(kept);
    };
    setLanded(keep);
    setVerdicts(keep);
  }, []);
  // blocks a reset took back: their performances go, and their cards are no longer landed
  const onDrop = useCallback((keys: readonly string[]) => {
    const gone = new Set(keys);
    setShows((queue) => {
      const kept = queue.flatMap((s): Show[] => {
        if (s.kind !== 'combat') return gone.has(s.key) ? [] : [s];
        const blocks = s.blocks.filter((b) => !gone.has(keyOf(s.turn, b.id)));
        if (blocks.length === 0) return [];
        return blocks.length === s.blocks.length ? [s] : [{ ...s, blocks }];
      });
      return kept.length === queue.length && kept.every((s, i) => s === queue[i]) ? queue : kept;
    });
    const drop = (before: ReadonlySet<string>) => {
      const kept = [...before].filter((key) => !gone.has(key));
      return kept.length === before.size ? before : new Set(kept);
    };
    setLanded(drop);
    setVerdicts(drop);
  }, []);

  const land = useCallback((keys: string[]) => {
    setLanded((before) => (keys.every((k) => before.has(k)) ? before : new Set([...before, ...keys])));
  }, []);
  const showDone = useCallback((done: Show) => {
    land(cardsOf(done));
    setShows((queue) => queue.filter((s) => s.key !== done.key));
  }, [land]);
  const verdict = useCallback((key: string) => setVerdicts((before) => new Set(before).add(key)), []);
  const settleShow = useCallback(
    (key: string) => (work: Promise<unknown>) => {
      settled(work);
      setStaged(key);
    },
    [settled],
  );

  // the cards a performance lands, held back until it does, and the fights' verdicts, by turn
  const heldByTurn = useMemo(() => {
    const held = new Map<number, ReadonlySet<string>>();
    for (const turn of live ? [...turns, live] : turns) {
      if (!performed.current.has(turn.no)) continue;
      held.set(turn.no, new Set(turn.blocks.filter((b) => isShowCard(b) && !landed.has(keyOf(turn.no, b.id))).map((b) => b.id)));
    }
    return held;
  }, [turns, live, landed]);
  const verdictsByTurn = useMemo(() => {
    const byTurn = new Map<number, Set<string>>();
    for (const key of verdicts) {
      const [no, id] = key.split(':') as [string, string];
      byTurn.set(Number(no), (byTurn.get(Number(no)) ?? new Set()).add(id));
    }
    return byTurn;
  }, [verdicts]);

  return { shows, staged, onShow, onRestart, onDrop, land, showDone, verdict, settleShow, heldByTurn, verdictsByTurn };
}
