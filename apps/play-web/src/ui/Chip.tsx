import { cx } from './cx';
import styles from './Chip.module.css';

export interface ChipProps {
  /** 「用 · 回气丹」「赠 · 青锋剑 → 白蘅」「往 · 太南谷」 */
  text: string;
  onRemove?: () => void;
  className?: string;
}

/** A queued action waiting above the input, sent with the next turn (spec 三, 行动签). */
export function Chip({ text, onRemove, className }: ChipProps) {
  return (
    <span className={cx(styles.chip, className)}>
      <i className={styles.dot} aria-hidden="true" />
      <span>{text}</span>
      {onRemove && (
        <button type="button" className={styles.remove} aria-label={`撤下 ${text}`} onClick={onRemove}>
          <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">
            <path d="M2 2l6 6M8 2L2 8" />
          </svg>
        </button>
      )}
    </span>
  );
}
