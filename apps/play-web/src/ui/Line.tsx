import type { SpeechBlock } from '../contracts';
import { cx } from './cx';
import styles from './Line.module.css';

export interface LineProps {
  block: SpeechBlock;
  /** the speaker's small head, cut from their portrait; without one the first character stands in */
  avatar?: string;
  className?: string;
}

/**
 * A spoken line (spec 三, 对白行): the speaker's round head, their name in brush with their role,
 * then each sentence on its own line. The player's own words carry 你 in place of a head.
 */
export function Line({ block, avatar, className }: LineProps) {
  const { speaker, lines } = block;
  const mine = speaker.self === true;
  return (
    <div className={cx(styles.line, className)} data-mine={mine ? '' : undefined}>
      {avatar && !mine ? (
        <img className={styles.head} src={avatar} alt="" />
      ) : (
        <span className={styles.head} aria-hidden="true">
          {mine ? '你' : [...speaker.name][0]}
        </span>
      )}
      <div className={styles.words}>
        <b className={styles.name}>
          {speaker.name}
          {speaker.role && <i>{speaker.role}</i>}
        </b>
        {lines.map((text, index) => (
          <p key={index}>{text}</p>
        ))}
      </div>
    </div>
  );
}
