import type { ButtonHTMLAttributes } from 'react';
import { cx } from './cx';
import styles from './Tool.module.css';

export interface ToolProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** One brush character: 合 (close), 回 (back), 日, 隐 */
  glyph: string;
  /** What it does, read out and shown as the tooltip: 「关闭」 */
  label: string;
}

/** The round button for single small actions such as closing a panel (spec 三, 圆钮). */
export function Tool({ glyph, label, className, ...rest }: ToolProps) {
  return (
    <button type="button" className={cx(styles.tool, className)} aria-label={label} title={label} {...rest}>
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}
