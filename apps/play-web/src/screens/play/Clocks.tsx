// The pressure clocks (压力钟, gameplay plan item 18; the mock-up's .fx-clock): one row each, the name in
// cinnabar, its segments, and a few words on how to turn it back. Phones stand them under the status bar,
// two rows at most: a third and more wait behind 「另有一口」 at the end of the second row, which opens
// them all. Desktops stand them to the right of the status bar. The rows measure their height for the
// name plate under them (--clocks-h on the page's layer), so they never cover it.
import { useLayoutEffect, useRef, useState } from 'react';
import type { PlayClock } from '../../contracts';
import { chineseNumber } from '../../lib/numerals';
import { Pips } from '../../ui/Pips';
import styles from './Clocks.module.css';

export interface ClocksProps {
  clocks: PlayClock[];
}

export function Clocks({ clocks }: ClocksProps) {
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const more = clocks.length - 2;

  useLayoutEffect(() => {
    const element = box.current;
    const layer = element?.parentElement;
    if (!element || !layer) return;
    // the rows and the room under them that keeps the plate clear of them
    const measure = () => layer.style.setProperty('--clocks-h', `${element.offsetHeight + 8}px`);
    measure();
    if (typeof ResizeObserver !== 'function') return () => layer.style.removeProperty('--clocks-h');
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      layer.style.removeProperty('--clocks-h');
    };
  }, []);

  if (clocks.length === 0) return null;
  return (
    <div ref={box} className={styles.clocks} role="group" aria-label="压力钟" data-open={open ? '' : undefined} data-more={more > 0 ? '' : undefined}>
      {clocks.map((clock, at) => (
        <p key={clock.id} className={styles.clock} data-at={at}>
          <b className={styles.name}>{clock.name}</b>
          <Pips value={clock.value} size={clock.size} name={clock.name} />
          <small className={styles.note}>{clock.note}</small>
          {at === 1 && more > 0 && !open && (
            <button type="button" className={styles.more} aria-expanded={false} onClick={() => setOpen(true)}>
              另有{more === 2 ? '两' : chineseNumber(more)}口
            </button>
          )}
        </p>
      ))}
      {open && (
        <button type="button" className={`${styles.more} ${styles.fold}`} aria-expanded onClick={() => setOpen(false)}>
          收起
        </button>
      )}
    </div>
  );
}
