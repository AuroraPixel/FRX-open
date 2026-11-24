// The first-meeting close-up (spec 六): black bars slide in, the rest of the page fades, the camera
// comes close; the name stands tall in brush with the role and a 初遇 seal, and the person's first
// line sits at the lower left. It holds at least 1.2 s, then a tap or any key ends it.
import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { EnterBlock } from '../../contracts';
import { Seal } from '../../ui/Marks';
import styles from './CloseUp.module.css';

/** The close-up stays at least this long. */
export const HOLD_MS = 1200;

/** Characters of the line a close-up holds: about two lines at its width. */
const LINE_BUDGET = 40;
/** A first sentence longer than this ends at a pause with 「……」. */
const LINE_MOST = 60;

/**
 * The words a close-up holds (spec 六, 他的第一句话): the person's first sentence, and the next ones while they
 * fit in about two lines, in their quote marks; a first sentence too long for that ends at a pause with 「……」.
 * The server gives the first paragraph he speaks, which ran to a hundred characters and under the black bar
 * (item 73's walkthrough, 茶摊伙计).
 */
export function firstWords(line: string): string {
  const text = line.trim();
  const open = text.startsWith('“') ? '“' : text.startsWith('「') ? '「' : '';
  const close = open === '“' ? '”' : open === '「' ? '」' : '';
  let inner = open ? text.slice(1) : text;
  if (close && inner.endsWith(close)) inner = inner.slice(0, -1);
  const sentences = inner.match(/[^。！？!?…]+(?:[。！？!?]+[”’」』]?|…+)?/g) ?? [inner];
  let said = sentences[0] ?? inner;
  for (const next of sentences.slice(1)) {
    if (said.length + next.length > LINE_BUDGET) break;
    said += next;
  }
  if (said.length > LINE_MOST) {
    const pause = Math.max(...['，', '、', '；', '：'].map((mark) => said.lastIndexOf(mark, LINE_MOST - 1)));
    said = `${said.slice(0, pause > LINE_MOST / 3 ? pause : LINE_MOST - 2)}……`;
  }
  return `${open}${said.trim()}${close}`;
}
/** The bars take this long to go (--d-bars). */
const LEAVE_MS = 700;

export interface CloseUpProps {
  entry: EnterBlock;
  /** 「青岚山 · 观云台 · 子时」 under the line */
  where: string;
  /** the player asked to go on: the page comes back while the bars leave */
  onLeave: () => void;
  /** the bars are gone */
  onGone: () => void;
}

export function CloseUp({ entry, where, onLeave, onGone }: CloseUpProps) {
  const box = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const asked = useRef(false);
  const calls = useRef({ onLeave, onGone });
  calls.current = { onLeave, onGone };

  const leave = useRef(() => {});
  leave.current = () => {
    if (leaving) return;
    setLeaving(true);
    calls.current.onLeave();
  };

  // at least 1.2 s; a tap or key before then is kept and acted on when the time is up
  useEffect(() => {
    const timer = setTimeout(() => {
      setHeld(true);
      if (asked.current) leave.current();
    }, HOLD_MS);
    return () => clearTimeout(timer);
  }, []);

  const ask = () => {
    if (held) leave.current();
    else asked.current = true;
  };
  const askRef = useRef(ask);
  askRef.current = ask;

  // every key ends it, and none reaches the page behind (the option keys, the panel keys)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Tab' || event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
      askRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  useEffect(() => {
    box.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => calls.current.onGone(), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  return (
    <div
      ref={box}
      className={styles.closeUp}
      data-leaving={leaving ? '' : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={`初遇 · ${entry.name}`}
      tabIndex={-1}
      onClick={ask}
    >
      <i className={styles.barTop} aria-hidden="true" />
      <i className={styles.barBottom} aria-hidden="true" />
      <div className={styles.title}>
        {/* a long name stands smaller, so its column ends above the line (--chars, CloseUp.module.css) */}
        <h2 className={styles.name} style={{ '--chars': [...entry.name].length } as CSSProperties}>
          {entry.name}
        </h2>
        {entry.role && <span className={styles.role}>{entry.role}</span>}
        <Seal glyph="初遇" small className={styles.seal} />
      </div>
      {entry.line && (
        <figure className={styles.words}>
          <blockquote className={styles.line}>{firstWords(entry.line)}</blockquote>
          <figcaption className={styles.where}>{where}</figcaption>
        </figure>
      )}
      <span className="visually-hidden">点按或按任意键继续</span>
    </div>
  );
}
