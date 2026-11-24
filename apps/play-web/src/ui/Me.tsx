import type { ActionBlock } from '../contracts';
import { cx } from './cx';
import styles from './Me.module.css';

export interface MeProps {
  block: ActionBlock;
  /** the turn was cancelled: the stroke turns grey and is struck through */
  cancelled?: boolean;
  className?: string;
}

/**
 * The player's own stroke at the head of a turn (spec 三, 玩家的那一笔): a margin note in FangSong.
 * Hidden chips stay out of it, as they stay out of the player's log.
 */
export function Me({ block, cancelled = false, className }: MeProps) {
  const shown = (block.queue ?? []).filter((item) => !item.silent);
  return (
    <p className={cx(styles.me, className)} data-cancelled={cancelled ? '' : undefined}>
      <b>你</b>
      <span>
        {block.text}
        {shown.length > 0 && <small className={styles.queue}>{shown.map((item) => item.text).join('　')}</small>}
      </span>
    </p>
  );
}
