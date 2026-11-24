import { type HTMLAttributes, type Ref, useEffect, useRef } from 'react';
import { cx } from './cx';
import styles from './Scroll.module.css';

export interface ScrollProps extends HTMLAttributes<HTMLDivElement> {
  /** the book's reading thread: a 1 px line on the right with a gold diamond where the reader is */
  thread?: boolean;
  /** fade the last stretch of the text into nothing (64 px, 34 px on phones) */
  fade?: boolean;
  scrollRef?: Ref<HTMLDivElement>;
}

/**
 * A scrolling region with the thin gold scrollbar (spec 三, 滚动条). Only the book and the panel
 * bodies scroll. The thread's diamond is moved through a CSS variable, without re-rendering.
 */
export function Scroll({ thread = false, fade = false, scrollRef, className, children, ...rest }: ScrollProps) {
  const box = useRef<HTMLDivElement | null>(null);
  const mark = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!thread || !el) return;
    let frame = 0;
    const place = () => {
      frame = 0;
      const room = el.scrollHeight - el.clientHeight;
      const at = room > 0 ? el.scrollTop / room : 0;
      mark.current?.style.setProperty('--at', at.toFixed(4));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    el.addEventListener('scroll', onScroll, { passive: true });
    // the room to scroll changes when the box does and when what it holds grows or shrinks (a turn
    // being written, a card landing, earlier turns fetched): the scroller's children are watched too,
    // and so is the list of them
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(onScroll) : undefined;
    const watch = () => {
      if (!observer) return;
      observer.observe(el);
      for (const child of el.children) observer.observe(child);
    };
    watch();
    const children = typeof MutationObserver === 'function' ? new MutationObserver(watch) : undefined;
    children?.observe(el, { childList: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      observer?.disconnect();
      children?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [thread]);

  const setRef = (el: HTMLDivElement | null) => {
    box.current = el;
    if (typeof scrollRef === 'function') scrollRef(el);
    else if (scrollRef) scrollRef.current = el;
  };

  return (
    <div className={cx(styles.frame, className)}>
      <div ref={setRef} className={styles.scroll} data-fade={fade ? '' : undefined} tabIndex={0} {...rest}>
        {children}
      </div>
      {thread && (
        <span className={styles.thread} aria-hidden="true">
          <i ref={mark} />
        </span>
      )}
    </div>
  );
}
