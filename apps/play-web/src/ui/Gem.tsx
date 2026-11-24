import type { ButtonHTMLAttributes } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';
import styles from './Gem.module.css';

export interface GemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The button's name; also its visible label */
  label: string;
  /** A line icon, or … */
  icon?: IconName;
  /** … a brush character in its place (the phone bar's 卷) */
  glyph?: string;
  selected?: boolean;
  /**
   * hover: floats in on hover and focus on desktops, always shown on phones (the nav rail).
   * below: two characters under the diamond (the phone's navigation grid).
   * none: the label is only read out.
   */
  labelMode?: 'hover' | 'below' | 'none';
}

/** The diamond button (spec 三, 菱形钮). */
export function Gem({ label, icon, glyph, selected, labelMode = 'hover', className, ...rest }: GemProps) {
  return (
    <button
      type="button"
      className={cx(styles.gem, className)}
      data-label={labelMode}
      aria-pressed={selected}
      aria-label={labelMode === 'none' ? label : undefined}
      {...rest}
    >
      <span className={styles.diamond} data-on={selected ? '' : undefined}>
        {icon ? <Icon name={icon} className={styles.icon} /> : <i className={styles.glyph}>{glyph}</i>}
      </span>
      {labelMode !== 'none' && <span className={styles.label}>{label}</span>}
    </button>
  );
}
