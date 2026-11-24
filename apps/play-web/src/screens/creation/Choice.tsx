import type { ReactNode } from 'react';
import { cx } from '../../ui/cx';
import styles from './Creation.module.css';

export interface ChoiceProps {
  title: string;
  /** what it costs, said: 「5 点」; nothing for what is free */
  cost?: string;
  /** a line of effects in gold: 「神识 +3 · 魅力 +2」 */
  bonus?: string;
  text?: ReactNode;
  chosen: boolean;
  /** cannot be chosen now; the reason is read out and shown */
  blocked?: string;
  /** a quality edge (a trait's rarity) */
  edge?: string;
  onChoose: () => void;
  className?: string;
}

/** A large list entry to choose (spec 七, 建角: 几张大的列表项，选中的金线). */
export function Choice({ title, cost, bonus, text, chosen, blocked, edge, onChoose, className }: ChoiceProps) {
  return (
    <button
      type="button"
      className={cx(styles.choice, className)}
      aria-pressed={chosen}
      aria-disabled={blocked && !chosen ? true : undefined}
      data-edge={edge ? '' : undefined}
      style={edge ? { borderLeftColor: edge } : undefined}
      onClick={() => {
        if (blocked && !chosen) return;
        onChoose();
      }}
    >
      <span className={styles.choiceHead}>
        <strong>{title}</strong>
        {cost && <span className={styles.cost}>{cost}</span>}
      </span>
      {bonus && <span className={styles.bonus}>{bonus}</span>}
      {text && <span className={styles.choiceText}>{text}</span>}
      {blocked && !chosen && <span className={styles.blocked}>{blocked}</span>}
    </button>
  );
}
