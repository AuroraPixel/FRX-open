// A check thrown before the reader's eyes (plan item 61; 演出: 骰点先出，再落结果的印): the card floats in
// with its numbers tumbling like dice, they settle, then the round stamp is pressed (成, 败, 吉, 凶).
// Only checks of a turn written in this visit roll; the turns of the history stand as they are. The
// sounds and the stage's flash go with the same timetable (useLiveShow).
import { useEffect, useState } from 'react';
import type { CheckBlock } from '../../contracts';
import { CheckCard } from '../../ui/Card';
import { showPin, useShowLevel } from './showClock';
import { DICE, checkPhase } from './shows';
import styles from './Shows.module.css';

/** When each rolling check's dice start, by `${turn}:${block}`: kept while the turn moves to the history. */
export const diceStarts = new Map<string, number>();

export function CheckShow({ block, start }: { block: CheckBlock; start: number }) {
  const level = useShowLevel();
  const pinned = showPin();
  const [now, setNow] = useState(() => performance.now());
  const elapsed = pinned ?? (now - start) / 1000;
  const phase = checkPhase(elapsed, level);

  // wake at the next step of the throw
  useEffect(() => {
    if (pinned !== null || phase === 'stamped') return;
    const p = level === 'full' ? DICE.full : DICE.weak;
    const next = start + (phase === 'roll' ? p.settle : p.stamp) * 1000;
    const timer = setTimeout(() => setNow(performance.now()), Math.max(0, next - performance.now()) + 4);
    return () => clearTimeout(timer);
  }, [phase, pinned, start, level, now]);

  return (
    <div className={styles.dice} data-phase={phase}>
      <CheckCard block={block} />
    </div>
  );
}
