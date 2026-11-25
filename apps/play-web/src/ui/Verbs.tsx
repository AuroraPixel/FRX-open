// The standing commands of the cultivation life (常驻指令, the mock-up's .fx-verbs and .fx-verb): a row of
// diamonds with a brush character in each and a two-character name under it. The one to do now is
// gilded; one that cannot be done now is faded with a dashed diamond, and says why without being pressed
// (VerbNotes, a line over the phone's bar or under the desktop's row). On phones the row stands in the
// bottom bar and ends with 自写 (the line instead) and 面板 (the panels); when the place offers more
// commands than the bar holds, they scroll sideways and 自写 and 面板 stay put at its end.
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import type { PlayVerb } from '../contracts';
import { cx } from './cx';
import styles from './Verbs.module.css';

/** A button's width on the phone's bar, and the least room between two. */
const BUTTON = 46;
const GAP = 2;

export interface VerbsProps {
  verbs: PlayVerb[];
  /** a command pressed, an off one too (its note is said) */
  onVerb: (verb: PlayVerb) => void;
  /** 去处: the places to set out for (the map panel's 近处) */
  onPlaces?: () => void;
  /** 日历: the calendar */
  onCalendar?: () => void;
  /** 自写: the player's own line in the commands' place */
  onOwn?: () => void;
  /** 面板: the panels */
  onPanels?: () => void;
  panelsOpen?: boolean;
  /** a turn is being written: nothing can be pressed */
  disabled?: boolean;
  /** spread across the width (the phone's bar) rather than in a row from the left (the desktop's book foot) */
  spread?: boolean;
  className?: string;
}

/**
 * Why the commands that cannot be done now cannot, a line each reason: 「修炼：内伤未愈，还要养八日」,
 * 「修炼、调息、静候：这场戏还没收场」.
 */
export function offReasons(verbs: readonly PlayVerb[]): { labels: string[]; note: string }[] {
  const out: { labels: string[]; note: string }[] = [];
  for (const verb of verbs) {
    if (!verb.off || !verb.note) continue;
    const same = out.find((line) => line.note === verb.note);
    if (same) same.labels.push(verb.label);
    else out.push({ labels: [verb.label], note: verb.note });
  }
  return out;
}

/** The reasons, said without a tap; nothing when every command can be done. */
export function VerbNotes({ verbs, className }: { verbs: readonly PlayVerb[]; className?: string }) {
  const lines = offReasons(verbs);
  if (!lines.length) return null;
  return (
    // the buttons' names say the same to a screen reader
    <div className={cx(styles.notes, className)} aria-hidden="true">
      {lines.map((line) => (
        <p key={line.note}>
          <b>{line.labels.join('、')}</b>
          {line.note}
        </p>
      ))}
    </div>
  );
}

/** What a screen reader hears for a command: its name, and why it cannot be done now. */
export function verbLabel(verb: PlayVerb): string {
  return verb.off ? `${verb.label}：${verb.note ?? '眼下用不了'}` : verb.note ? `${verb.label}：${verb.note}` : verb.label;
}

function Diamond({ glyph, label }: { glyph: string; label: string }) {
  return (
    <>
      <span className={styles.d} aria-hidden="true">
        <span>{glyph}</span>
      </span>
      <em aria-hidden="true">{label}</em>
    </>
  );
}

export function Verbs({
  verbs,
  onVerb,
  onPlaces,
  onCalendar,
  onOwn,
  onPanels,
  panelsOpen = false,
  disabled = false,
  spread = false,
  className,
}: VerbsProps) {
  const row = useRef<HTMLDivElement>(null);
  const [crowded, setCrowded] = useState(false);
  const count = verbs.length + [onPlaces, onCalendar, onOwn, onPanels].filter(Boolean).length;
  // the phone's bar: more buttons than its width holds scroll sideways, 自写 and 面板 kept at the end
  useLayoutEffect(() => {
    const element = row.current;
    if (!spread || !element) return;
    // a bar not laid out yet (no width) is not crowded; the observer measures it again once it is
    const measure = () => setCrowded(element.clientWidth > 0 && count * BUTTON + (count - 1) * GAP > element.clientWidth + 0.5);
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [spread, count]);

  const commands = verbs.map((verb) => (
    <button
      key={verb.kind}
      type="button"
      className={styles.verb}
      data-main={verb.main && !verb.off ? '' : undefined}
      data-off={verb.off ? '' : undefined}
      aria-label={verbLabel(verb)}
      aria-disabled={verb.off || undefined}
      title={verb.note}
      disabled={disabled}
      onClick={() => onVerb(verb)}
    >
      <Diamond glyph={verb.glyph} label={verb.label} />
    </button>
  ));
  const more = (
    <>
      {onPlaces && (
        <button type="button" className={styles.verb} aria-label="去处" onClick={onPlaces}>
          <Diamond glyph="往" label="去处" />
        </button>
      )}
      {onCalendar && (
        <button type="button" className={styles.verb} aria-label="日历" onClick={onCalendar}>
          <Diamond glyph="历" label="日历" />
        </button>
      )}
    </>
  );
  const ends = (
    <>
      {onOwn && (
        <button type="button" className={styles.verb} aria-label="自写：写下你自己的行动" aria-controls="own-action" aria-expanded={false} disabled={disabled} onClick={onOwn}>
          <Diamond glyph="书" label="自写" />
        </button>
      )}
      {onPanels && (
        <button
          type="button"
          className={styles.verb}
          data-main={panelsOpen ? '' : undefined}
          aria-label="面板"
          aria-pressed={panelsOpen}
          onClick={onPanels}
        >
          <Diamond glyph="卷" label="面板" />
        </button>
      )}
    </>
  );
  const body: ReactNode = crowded ? (
    <>
      <div className={styles.strip}>
        {commands}
        {more}
      </div>
      <span className={styles.ends}>{ends}</span>
    </>
  ) : (
    <>
      {commands}
      {more}
      {ends}
    </>
  );
  return (
    <div
      ref={row}
      className={cx(styles.verbs, className)}
      role="group"
      aria-label="常驻指令"
      data-spread={spread ? '' : undefined}
      data-crowded={crowded ? '' : undefined}
    >
      {body}
    </div>
  );
}
