// 悟得 on offer after a major gate (gameplay plan item 24): a small heading (悟得, 三条择一) and three
// cards, the name in brush, what it does under it, and a small seal on a rare one. Pressing one asks
// first (the page's dialog), then sends verb { kind: 'perk', index }.
import { useId } from 'react';
import type { PerkChoice } from '../contracts';
import { cx } from './cx';
import { Sub } from './Sub';
import styles from './Perks.module.css';

export interface PerksProps {
  items: PerkChoice[];
  /** a card pressed; without it the cards are only shown */
  onPick?: (item: PerkChoice) => void;
  /** a turn is being written */
  disabled?: boolean;
  className?: string;
}

/** What a screen reader hears for a card. */
export function perkLabel(item: PerkChoice): string {
  return `${item.name}${item.rare ? '，稀有' : ''}：${item.text}`;
}

export function Perks({ items, onPick, disabled = false, className }: PerksProps) {
  const id = useId();
  return (
    <section className={cx(styles.offer, className)} aria-labelledby={id}>
      <Sub id={id} className={styles.head}>
        悟得<small>三条择一</small>
      </Sub>
      <ol className={styles.perks}>
        {items.map((item) => (
          <li key={item.index}>
            <button
              type="button"
              className={styles.perk}
              data-rare={item.rare ? '' : undefined}
              aria-label={perkLabel(item)}
              aria-disabled={onPick ? undefined : true}
              disabled={disabled}
              onClick={() => onPick?.(item)}
            >
              <strong>{item.name}</strong>
              <span>{item.text}</span>
              {item.rare && (
                <i className={styles.rare} aria-hidden="true">
                  稀
                </i>
              )}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
