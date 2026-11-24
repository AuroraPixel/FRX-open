import type { ReactNode } from 'react';
import { cx } from './cx';
import styles from './KV.module.css';

export interface KVItem {
  label: string;
  value: ReactNode;
  /** a change shown in jade after the value: 「+3」 */
  delta?: string;
}

/**
 * The two-column key-value table (spec 三, 键值表). On phones a cell whose label is longer than
 * four characters takes the whole row.
 */
export function KV({ items, className }: { items: KVItem[]; className?: string }) {
  return (
    <dl className={cx(styles.kv, className)}>
      {items.map((item) => (
        <div key={item.label} className={styles.cell} data-long={item.label.length > 4 ? '' : undefined}>
          <dt>{item.label}</dt>
          <dd>
            {item.value}
            {item.delta && <em>{item.delta}</em>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
