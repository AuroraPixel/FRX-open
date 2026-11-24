import { cx } from './cx';
import styles from './Marks.module.css';

interface MarkProps {
  glyph: string;
  className?: string;
  /** read out instead of the glyph */
  label?: string;
}

function a11y(label: string | undefined) {
  return label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const };
}

// data-mark: these are emblems; the contrast check holds them to the 3:1 of graphics (tools/audits.mjs).

/** A gold diamond with one brush character: 卜 for a check, 战 for a clash (spec 三, 标记). */
export function Mark({ glyph, className, label }: MarkProps) {
  return (
    <span className={cx(styles.mark, className)} data-mark="" {...a11y(label)}>
      <i>{glyph}</i>
    </span>
  );
}

/**
 * A cinnabar seal (spec 三, 印章). The square one heads receipts; the small one is the name plate's
 * relation (初识) and a finished entry's mark, set upright or tilted.
 */
export function Seal({ glyph, className, label, small = false, tilt = false }: MarkProps & { small?: boolean; tilt?: boolean }) {
  return (
    <span
      className={cx(styles.seal, className)}
      data-mark=""
      data-small={small ? '' : undefined}
      data-tilt={tilt ? '' : undefined}
      {...a11y(label)}
    >
      {glyph}
    </span>
  );
}

/** A round cinnabar stamp, tilted: 成, 败, 吉, 凶, 中, 空, 胜, 负 (spec 三, 圆印). */
export function Stamp({ glyph, className, label }: MarkProps) {
  return (
    <span className={cx(styles.stamp, className)} data-mark="" {...a11y(label)}>
      {glyph}
    </span>
  );
}
