import type { ReactNode } from 'react';
import { cx } from './cx';
import { Seal } from './Marks';
import styles from './Entry.module.css';

export interface EntryProps {
  title: string;
  text?: ReactNode;
  /** the brush character at the top right: 进, 成, 未 */
  status?: string;
  /** active: gold line; done: cinnabar line and the status as a tilted seal; locked: all grey */
  state?: 'active' | 'done' | 'locked' | 'plain';
  onClick?: () => void;
  selected?: boolean;
  className?: string;
}

/** A row in a list of quests, people or saves (spec 三, 列表项). */
export function Entry({ title, text, status, state = 'plain', onClick, selected, className }: EntryProps) {
  const body = (
    <>
      <strong className={styles.title}>{title}</strong>
      {text && <span className={styles.text}>{text}</span>}
      {status &&
        (state === 'done' ? (
          <Seal glyph={status} small tilt className={styles.status} />
        ) : (
          <em className={styles.status} aria-hidden="true">
            {status}
          </em>
        ))}
    </>
  );
  const shared = {
    className: cx(styles.entry, className),
    'data-state': state,
    // a locked entry is greyed because it cannot be used yet
    'aria-disabled': state === 'locked' ? true : undefined,
  };
  return onClick ? (
    <button type="button" {...shared} aria-pressed={selected} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div {...shared}>{body}</div>
  );
}
