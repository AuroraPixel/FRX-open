import type { ButtonHTMLAttributes, MouseEvent } from 'react';
import { cx } from './cx';
import styles from './Act.module.css';

export interface ActProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> {
  /** The brush character in the small diamond: 壹, 修, 破 */
  glyph: string;
  /** 「闭关修炼」 */
  name: string;
  /** 「耗一块灵石 · 一日」 */
  note?: string;
  /** The one action that matters most right now glows slowly */
  hot?: boolean;
  /** Not available; it stays focusable so the note can say why */
  unavailable?: boolean;
}

/**
 * The large cut-corner action button (spec 三, 行动钮). The glow sits on a wrapper because the
 * button's own clip-path would cut it off.
 */
export function Act({ glyph, name, note, hot = false, unavailable = false, className, onClick, ...rest }: ActProps) {
  const click = (event: MouseEvent<HTMLButtonElement>) => {
    if (unavailable) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  return (
    <span className={cx(styles.wrap, className)} data-hot={hot && !unavailable ? '' : undefined}>
      <button
        type="button"
        className={styles.act}
        aria-disabled={unavailable || undefined}
        onClick={click}
        {...rest}
      >
        <span className={styles.key} aria-hidden="true">
          <i>{glyph}</i>
        </span>
        <span className={styles.words}>
          <strong>{name}</strong>
          {note && <small>{note}</small>}
        </span>
      </button>
    </span>
  );
}
