// The phone's bottom bar (spec 十一, 底栏): a pending settlement's note, the queued chips in one row, the
// player's own line and the 卷 diamond that opens the panels. It follows the keyboard; its height is where
// the book page ends (--bar-h, on the book's parent). In the cultivation life, outside a scene or a fight,
// the bar is the row of standing commands instead (gameplay plan item 13); its 自写 brings the line,
// with a diamond beside it back to the commands.
import { type ReactNode, type RefObject, useLayoutEffect, useRef } from 'react';
import { Gem } from '../../ui/Gem';
import styles from './PlayScreen.module.css';

export interface PhoneBarProps {
  bookRef: RefObject<HTMLElement | null>;
  /** the pending settlement's card, when a turn waits for it */
  pending?: ReactNode;
  chips?: ReactNode;
  own: ReactNode;
  navOpen: boolean;
  onNav: () => void;
  /** the cultivation life: the standing commands, in the line's place */
  verbs?: ReactNode;
  /** the cultivation life: why commands cannot be done now, over the commands */
  notes?: ReactNode;
  /** the cultivation life, the line taken with 自写: back to the commands */
  onVerbs?: () => void;
}

export function PhoneBar({ bookRef, pending, chips, own, navOpen, onNav, verbs, notes, onVerbs }: PhoneBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bar = barRef.current;
    const screen = bookRef.current?.parentElement;
    if (!bar || !screen || typeof ResizeObserver !== 'function') return;
    // on the root too: the page's notices (app.tsx) stand over the bar as tall as it is
    const root = document.documentElement;
    const measure = () => {
      screen.style.setProperty('--bar-h', `${bar.offsetHeight}px`);
      root.style.setProperty('--bar-h', `${bar.offsetHeight}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--bar-h');
    };
  }, [bookRef]);
  return (
    <div ref={barRef} className={styles.bar} data-bar="" data-verbs={verbs ? '' : undefined}>
      {pending && <div className={styles.barNote}>{pending}</div>}
      {chips}
      {verbs && notes}
      {verbs ? (
        <div className={styles.barRow}>{verbs}</div>
      ) : (
        <div className={styles.barRow}>
          {onVerbs && <Gem glyph="令" label="指令" aria-label="回到常驻指令" labelMode="below" aria-controls="own-action" aria-expanded onClick={onVerbs} />}
          {own}
          <Gem glyph="卷" label="导航" labelMode="none" selected={navOpen} onClick={onNav} />
        </div>
      )}
    </div>
  );
}
