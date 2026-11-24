import { cx } from './cx';
import styles from './Bar.module.css';

export interface BarProps {
  /** Two characters: 气血, 法力 */
  label: string;
  current: number;
  max: number;
  /** hp and mp use the spec's gradients; gold is for proficiency, usage and the like */
  tone?: 'hp' | 'mp' | 'gold';
  className?: string;
}

/** A slanted bar with its name on the left and 「86 / 120」 on the right (spec 三, 条). */
export function Bar({ label, current, max, tone = 'hp', className }: BarProps) {
  const share = max > 0 ? Math.min(1, Math.max(0, current / max)) : 0;
  return (
    <div className={cx(styles.row, className)}>
      <span className={styles.label}>{label}</span>
      <span
        className={styles.bar}
        data-tone={tone}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={current}
      >
        <i className={styles.fill} style={{ width: `${(share * 100).toFixed(2)}%` }} />
      </span>
      <b className={styles.value}>
        {current} / {max}
      </b>
    </div>
  );
}
