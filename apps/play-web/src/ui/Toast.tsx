import { type KeyboardEvent, useEffect, useRef } from 'react';
import { Btn } from './Btn';
import { cx } from './cx';
import styles from './Toast.module.css';

export interface ToastProps {
  text: string;
  /** an error stays until dismissed and may offer 重试 */
  kind?: 'info' | 'error';
  onRetry?: () => void;
  /** called when an info toast has faded (after 3 s) */
  onDone?: () => void;
  /** puts the toast away: a small cross at its end, and Esc while the focus is in it */
  onClose?: () => void;
  className?: string;
}

const LIFETIME = 3000;

/**
 * A short notice over the top of the book (spec 三, 提示 · new design). Every toast the player may put away
 * has the cross: an error without 重试 used to stay until the next error took its place.
 */
export function Toast({ text, kind = 'info', onRetry, onDone, onClose, className }: ToastProps) {
  // the 3 s run from when the words came, not from the latest render: a host that hands a new onDone each
  // time (another notice added) restarted it, and a toast under others never went (the documents pass, #16)
  const done = useRef(onDone);
  done.current = onDone;
  const fades = kind === 'info' && Boolean(onDone);
  useEffect(() => {
    if (!fades) return;
    const timer = setTimeout(() => done.current?.(), LIFETIME);
    return () => clearTimeout(timer);
  }, [fades, text]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !onClose) return;
    // the toast's Esc closes the toast only, not the panel or the dialog behind it
    event.stopPropagation();
    event.preventDefault();
    onClose();
  };

  return (
    <div
      className={cx(styles.toast, className)}
      data-kind={kind}
      data-live={kind === 'info' && onDone ? '' : undefined}
      role={kind === 'error' ? 'alert' : 'status'}
      onKeyDown={onClose ? onKeyDown : undefined}
    >
      <span className={styles.text}>{text}</span>
      {kind === 'error' && onRetry && <Btn onClick={onRetry}>重试</Btn>}
      {onClose && (
        <button type="button" className={styles.close} aria-label="关闭提示" title="关闭提示" onClick={onClose}>
          <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">
            <path d="M2 2l6 6M8 2L2 8" />
          </svg>
        </button>
      )}
    </div>
  );
}
