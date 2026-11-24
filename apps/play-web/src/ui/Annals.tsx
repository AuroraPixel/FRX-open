// The annals of the cultivation life (年谱, the mock-up's .fx-annals and .fx-annal): the days the engine
// settled at once, a line each, strung on a thin line at the left with a small diamond for each line;
// the date in gold, the newest line's diamond filled. At the end of the newest line, 「写一段」 asks the
// model to write those days out.
import type { ReactNode } from 'react';
import { cx } from './cx';
import { Pips } from './Pips';
import styles from './Annals.module.css';

export interface AnnalLine {
  id: string;
  /** the day the stretch began: 「正月初三」 */
  date: string;
  /** 「观云台。闭关四十日，修为六十至九十。」 */
  text: string;
  /** the newest line */
  now?: boolean;
  /** the pressure clock that moved in these days: its segments stand beside the line */
  clock?: { name: string; size: number; value: number };
}

export interface AnnalsProps {
  lines: AnnalLine[];
  /** 「写一段」 at the end of the newest line; without it the line ends with its words */
  onElaborate?: (line: AnnalLine) => void;
  /** a turn is being written, or a scene is under way: 写一段 waits */
  elaborateOff?: boolean;
  className?: string;
}

const NUMBER = '[零一二三四五六七八九十百千万两]+';
const PROGRESS = new RegExp(`(修为)(${NUMBER})(至)(${NUMBER})`);

/** 「修为六十至九十」 with its two numbers standing out, as the mock-up writes it. */
function emphasised(text: string): ReactNode {
  const match = PROGRESS.exec(text);
  if (!match) return text;
  const [whole, word, from, joiner, to] = match as unknown as [string, string, string, string, string];
  const start = match.index;
  // a space each side of a number, as the mock-up sets them: 「修为 六十 至 九十。」
  return (
    <>
      {text.slice(0, start)}
      {word} <b>{from}</b> {joiner} <b>{to}</b>
      {text.slice(start + whole.length)}
    </>
  );
}

export function Annals({ lines, onElaborate, elaborateOff = false, className }: AnnalsProps) {
  return (
    <ol className={cx(styles.annals, className)} aria-label="年谱" data-annals="">
      {lines.map((line) => (
        <li key={line.id} className={styles.annal} data-now={line.now ? '' : undefined}>
          <time className={styles.date}>{line.date}</time>
          <span className={styles.text}>{emphasised(line.text)}</span>
          {line.clock && <Pips value={line.clock.value} size={line.clock.size} name={line.clock.name} small className={styles.clock} />}
          {line.now && onElaborate && (
            <button
              type="button"
              className={styles.more}
              disabled={elaborateOff}
              aria-label={`写一段：${line.date}，${line.text}`}
              onClick={() => onElaborate(line)}
            >
              写一段
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}
