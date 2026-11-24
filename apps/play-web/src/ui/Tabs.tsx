import { type KeyboardEvent, useRef } from 'react';
import { cx } from './cx';
import styles from './Tabs.module.css';

export interface TabItem {
  id: string;
  label: string;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** read out for the row: 「行囊分类」 */
  label: string;
  /** the id of the panel the tabs control */
  controls?: string;
  className?: string;
}

/**
 * A row of text tabs (spec 三, 标签页 · new design): the chosen one turns to ink over a 2 px gold
 * line with a small diamond at each end. Arrow keys move between tabs; on phones the row scrolls
 * sideways instead of wrapping.
 */
export function Tabs({ items, value, onChange, label, controls, className }: TabsProps) {
  const row = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity };
    const step = keys[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const at = items.findIndex((item) => item.id === value);
    const index =
      step === -Infinity ? 0 : step === Infinity ? items.length - 1 : (at + step + items.length) % items.length;
    const next = items[index];
    if (!next) return;
    onChange(next.id);
    row.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus();
  };

  return (
    <div ref={row} className={cx(styles.tabs, className)} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {items.map((item) => {
        const on = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            className={styles.tab}
            aria-selected={on}
            aria-controls={controls}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(item.id)}
          >
            {item.label}
            {on && (
              <i className={styles.rule} aria-hidden="true">
                <b />
                <b />
              </i>
            )}
          </button>
        );
      })}
    </div>
  );
}
