import type { ButtonHTMLAttributes } from 'react';
import { cx } from './cx';
import styles from './Medal.module.css';

const RADIUS = 30;
const ARC = 2 * Math.PI * RADIUS;

export interface MedalProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The realm's first character: 炼, 筑, 丹, 婴, 神 */
  glyph: string;
  /** Cultivation progress toward the next realm, 0 to 1 */
  progress: number;
  /** Read out by screen readers, e.g. 「炼气十三层，修为 96 / 100，打开角色」 */
  label: string;
}

/** The realm ring (spec 三, 境界圆环): ticks that turn slowly, a gold arc for progress, one brush glyph. */
export function Medal({ glyph, progress, label, className, ...rest }: MedalProps) {
  const done = Math.min(1, Math.max(0, progress));
  return (
    <button type="button" className={cx(styles.medal, className)} aria-label={label} {...rest}>
      <svg viewBox="0 0 76 76" aria-hidden="true" focusable="false">
        <circle className={styles.ticks} cx="38" cy="38" r="36.5" data-endless="" />
        <circle className={styles.track} cx="38" cy="38" r={RADIUS} />
        <circle
          className={styles.arc}
          cx="38"
          cy="38"
          r={RADIUS}
          strokeDasharray={ARC.toFixed(2)}
          strokeDashoffset={(ARC * (1 - done)).toFixed(2)}
          data-empty={done === 0 ? '' : undefined}
        />
      </svg>
      <b className={styles.glyph}>{glyph}</b>
    </button>
  );
}
