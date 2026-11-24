import type { ButtonHTMLAttributes } from 'react';
import { cx } from './cx';
import styles from './Btn.module.css';

export interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** line: gold outline (the usual); solid: the one main action; danger: irreversible, in cinnabar */
  variant?: 'line' | 'solid' | 'danger';
}

/** The text button (spec 三, 文字钮). */
export function Btn({ variant = 'line', className, type = 'button', ...rest }: BtnProps) {
  return <button type={type} className={cx(styles.btn, className)} data-variant={variant} {...rest} />;
}
