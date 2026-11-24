// 丹毒 (gameplay plan item 44; the design's 八「丹药和丹毒」): a slanted bar like 气血's, filling from jade
// through gold to cinnabar, with a line at each of its marks (法力上限 at 50, 修炼 slower at 70, the cap)
// and their numbers under it; the effects in force, a line each, under that.
import type { PlayToxin } from '../contracts';
import { cx } from './cx';
import styles from './Toxin.module.css';

/** What a screen reader hears for the bar. */
export function toxinWords(toxin: PlayToxin): string {
  return [`${toxin.value} / ${toxin.cap}`, ...toxin.effects].join('，');
}

export function Toxin({ toxin, className }: { toxin: PlayToxin; className?: string }) {
  const cap = Math.max(1, toxin.cap);
  const share = Math.min(1, Math.max(0, toxin.value / cap));
  const at = (mark: number) => `${(Math.min(1, Math.max(0, mark / cap)) * 100).toFixed(2)}%`;
  return (
    <div className={cx(styles.toxin, className)}>
      <div className={styles.row}>
        <span className={styles.label}>丹毒</span>
        <span
          className={styles.bar}
          role="meter"
          aria-label="丹毒"
          aria-valuemin={0}
          aria-valuemax={cap}
          aria-valuenow={toxin.value}
          aria-valuetext={toxinWords(toxin)}
        >
          <i className={styles.fill} style={{ width: `${(share * 100).toFixed(2)}%`, backgroundSize: share > 0 ? `${(100 / share).toFixed(2)}% 100%` : undefined }} />
          {toxin.marks.map((mark) => (
            <u key={mark} className={styles.mark} data-past={toxin.value >= mark ? '' : undefined} style={{ left: at(mark) }} />
          ))}
        </span>
        <b className={styles.value}>
          {toxin.value} / {cap}
        </b>
      </div>
      <div className={styles.scale} aria-hidden="true">
        {toxin.marks.map((mark) => (
          <span key={mark} data-end={mark >= cap ? '' : undefined} data-past={toxin.value >= mark ? '' : undefined} style={{ left: at(mark) }}>
            {mark}
          </span>
        ))}
      </div>
      {toxin.effects.length > 0 && (
        <ul className={styles.effects}>
          {toxin.effects.map((effect) => (
            <li key={effect}>{effect}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
