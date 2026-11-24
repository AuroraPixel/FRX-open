import type { ButtonHTMLAttributes, HTMLAttributes } from 'react';
import { cx } from './cx';
import styles from './Slot.module.css';

/** Quality names, so quality is never told by colour alone (spec 十二). */
export const GRADE_NAMES = { 1: '凡品', 2: '良品', 3: '上品', 4: '极品', 5: '绝品' } as const;
export type Grade = keyof typeof GRADE_NAMES;

export interface SlotThing {
  name: string;
  grade: Grade;
  quantity?: number;
  /** an icon picture; without one the slot shows one brush character */
  icon?: string;
  /** the brush character; the last character of the name when not given (青锋剑 → 剑) */
  glyph?: string;
}

export interface SlotProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** null or missing: an empty slot */
  thing?: SlotThing | null;
  /** what an empty slot holds, read out and shown faintly: 「法宝」 */
  emptyLabel?: string;
  selected?: boolean;
}

/** A square item slot (spec 三, 格子): the edge colour tells the quality. */
export function Slot({ thing, emptyLabel, selected, className, ...rest }: SlotProps) {
  if (!thing) {
    return (
      <button
        type="button"
        className={cx(styles.slot, className)}
        data-empty=""
        aria-pressed={selected}
        aria-label={emptyLabel ? `空 · ${emptyLabel}` : '空'}
        {...rest}
      >
        <i className={styles.dot} aria-hidden="true" />
        {emptyLabel && <span aria-hidden="true">{emptyLabel}</span>}
      </button>
    );
  }
  const glyph = thing.glyph ?? [...thing.name].pop() ?? '';
  return (
    <button
      type="button"
      className={cx(styles.slot, className)}
      data-grade={thing.grade}
      aria-pressed={selected}
      aria-label={`${thing.name} · ${GRADE_NAMES[thing.grade]}${thing.quantity !== undefined ? ` · ${thing.quantity}` : ''}`}
      {...rest}
    >
      {thing.icon ? <img src={thing.icon} alt="" /> : <b aria-hidden="true">{glyph}</b>}
      <span aria-hidden="true">{thing.name}</span>
      {thing.quantity !== undefined && (
        <i className={styles.count} aria-hidden="true">
          {thing.quantity}
        </i>
      )}
    </button>
  );
}

/** Slots in rows of four, three on screens under 340 px. */
export function SlotGrid({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx(styles.grid, className)} {...rest} />;
}
