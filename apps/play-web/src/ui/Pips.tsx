// A pressure clock's segments (压力钟, the mock-up's .fx-pips): a row of small diamonds, the full ones in
// cinnabar. Read out as 「六格之四」: six segments, four full.
import { chineseNumber } from '../lib/numerals';
import { cx } from './cx';
import styles from './Pips.module.css';

export interface PipsProps {
  value: number;
  size: number;
  /** said before the segments: the clock's name (an annals line names the clock that moved) */
  name?: string;
  /** the 6 px diamonds of an annals line, not the 8 px of the clocks under the status */
  small?: boolean;
  className?: string;
}

/** 「六格之四」 */
export function pipsLabel(value: number, size: number): string {
  return `${chineseNumber(size)}格之${chineseNumber(Math.max(0, Math.min(value, size)))}`;
}

export function Pips({ value, size, name, small = false, className }: PipsProps) {
  const label = pipsLabel(value, size);
  return (
    <span className={cx(styles.pips, className)} data-small={small ? '' : undefined} role="img" aria-label={name ? `${name} ${label}` : label}>
      {Array.from({ length: size }, (_, at) => (
        <i key={at} data-on={at < value ? '' : undefined} />
      ))}
    </span>
  );
}
