import { type KeyboardEvent, type PointerEvent, useEffect, useRef } from 'react';
import type { OptionItem } from '../contracts';
import { optionNumeral } from '../lib/numerals';
import { cx } from './cx';
import styles from './Opts.module.css';

export interface OptsProps {
  items: OptionItem[];
  onPick: (item: OptionItem) => void;
  disabled?: boolean;
  /** keys 1 to 6 pick an option directly, unless a text field has focus (spec 十二) */
  hotkeys?: boolean;
  className?: string;
}

/** True when typing should not trigger shortcuts. */
export function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * The options under a turn (spec 三, 选项): 壹贰叁 in brush and the text. A click sends at once; the
 * arrow keys move between them; a finger that moved more than 10 px was scrolling, not choosing.
 */
export function Opts({ items, onPick, disabled = false, hotkeys = false, className }: OptsProps) {
  const list = useRef<HTMLOListElement>(null);
  const press = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);

  useEffect(() => {
    if (!hotkeys || disabled) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || typingInto(event.target)) return;
      const index = Number(event.key);
      const item = items.find((option) => option.index === index);
      if (item && index >= 1 && index <= 6) {
        event.preventDefault();
        onPick(item);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hotkeys, disabled, items, onPick]);

  const onKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = [...(list.current?.querySelectorAll('button') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[(at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  const onPointerDown = (event: PointerEvent) => {
    press.current = { x: event.clientX, y: event.clientY };
    moved.current = false;
  };
  const onPointerMove = (event: PointerEvent) => {
    const start = press.current;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) moved.current = true;
  };

  return (
    <ol
      ref={list}
      className={cx(styles.opts, className)}
      aria-label="抉择"
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
    >
      {items.map((item) => (
        <li key={item.index}>
          <button
            type="button"
            className={styles.opt}
            disabled={disabled}
            onClick={() => {
              if (moved.current) return;
              onPick(item);
            }}
          >
            <i aria-hidden="true">{optionNumeral(item.index)}</i>
            <span>{item.text}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
