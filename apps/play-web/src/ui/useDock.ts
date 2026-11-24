import { type PointerEvent as ReactPointerEvent, type RefObject, useCallback, useEffect, useRef } from 'react';
import { type DockSizes, type DockStop, Tracker, riseDock, settleDock } from './drag';

/** The book's top edge at its two docking places on a phone (spec 十一, 书页). */
export function dockSizes(
  viewport = globalThis.visualViewport?.height ?? globalThis.innerHeight,
  safeTop = 0,
  fullTop = 96,
): DockSizes {
  return { half: viewport * 0.41, full: fullTop + safeTop };
}

/** Lands the page from where the finger left it: the drag's offset becomes the start of the CSS
 *  transition of its top, instead of a jump back to the old place before it moves to the new one. */
function glide(book: HTMLElement) {
  const at = book.getBoundingClientRect().top - (book.offsetParent?.getBoundingClientRect().top ?? 0);
  book.style.transition = 'none';
  book.style.transform = '';
  book.style.top = `${at}px`;
  void book.offsetHeight;
  book.style.transition = '';
  book.style.top = '';
}

export interface DockOptions {
  /** phones only */
  enabled: boolean;
  dock: DockStop;
  onDock: (dock: DockStop) => void;
  /** the safe-area inset at the top, for the full position */
  safeTop?: number;
  /** room for the status above the fully open book, before the safe area */
  fullTop?: number;
}

/**
 * The phone's book page between its two docking places (spec 十一): half open with its top at 41% of
 * the screen, or fully open under the status bar. Dragging or tapping the book's head moves it; a swipe
 * up the half-open page's text opens it fully, and a downward pull at the top of the scrolled text
 * brings it back to half. The page itself is placed by CSS from data-dock; during a drag the hook only
 * writes a transform, so React does not re-render.
 */
export function useDock(
  bookRef: RefObject<HTMLElement | null>,
  bodyRef: RefObject<HTMLElement | null>,
  { enabled, dock, onDock, safeTop = 0, fullTop = 96 }: DockOptions,
) {
  const tracker = useRef<Tracker | null>(null);
  const latest = useRef({ dock, onDock, safeTop, fullTop });
  latest.current = { dock, onDock, safeTop, fullTop };

  /** keeps the head between the two places while it follows the finger */
  const follow = useCallback(
    (dy: number) => {
      const book = bookRef.current;
      if (!book) return 0;
      const sizes = dockSizes(undefined, latest.current.safeTop, latest.current.fullTop);
      const from = latest.current.dock === 'full' ? sizes.full : sizes.half;
      const clamped = Math.min(sizes.half - from, Math.max(sizes.full - from, dy));
      book.style.transition = 'none';
      book.style.transform = `translateY(${clamped}px)`;
      return clamped;
    },
    [bookRef],
  );

  const release = useCallback(
    (dy: number, velocity: number) => {
      const book = bookRef.current;
      const { dock: from, onDock: settle, safeTop: top } = latest.current;
      const next = settleDock(from, dy, velocity, dockSizes(undefined, top, latest.current.fullTop));
      if (book) glide(book);
      if (next !== from) settle(next);
    },
    [bookRef],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest('button, a, input, textarea, select')) return;
      tracker.current = new Tracker(event.clientY, event.timeStamp);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [enabled],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (tracker.current) follow(tracker.current.move(event.clientY, event.timeStamp));
    },
    [follow],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const track = tracker.current;
      if (!track) return;
      tracker.current = null;
      const dy = track.move(event.clientY, event.timeStamp);
      if (Math.abs(dy) < 6) {
        // a tap on the head switches between the two places
        const { dock: from, onDock: settle } = latest.current;
        settle(from === 'full' ? 'half' : 'full');
        return;
      }
      release(follow(dy), track.velocity());
    },
    [follow, release],
  );

  const onPointerCancel = useCallback(() => {
    if (!tracker.current) return;
    tracker.current = null;
    release(0, 0);
  }, [release]);

  // The text moves the page too, the way a phone's bottom sheet does: reading on (a swipe up the text)
  // opens the half-open page fully before the text scrolls, so a turn is read in the whole screen and
  // not in the 40% under the picture; a downward pull with the text at its top takes the fully open
  // page back to half. A mouse wheel turned towards the end of the text opens it as well.
  useEffect(() => {
    const body = bodyRef.current;
    if (!enabled || !body) return;
    let pull: Tracker | null = null;
    let from: DockStop = 'half';
    let atTop = false;
    let dragging = false;
    const start = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch || event.touches.length > 1) return;
      pull = new Tracker(touch.clientY, event.timeStamp);
      from = latest.current.dock;
      atTop = body.scrollTop <= 0;
      dragging = false;
    };
    const move = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!pull || !touch) return;
      const dy = pull.move(touch.clientY, event.timeStamp);
      if (!dragging) {
        if (from === 'half' ? dy < -6 : atTop && dy > 6) dragging = true;
        else {
          if (from === 'full' && dy < 0) atTop = false;
          return;
        }
      }
      event.preventDefault();
      follow(dy);
    };
    const end = (event: TouchEvent) => {
      if (!pull) return;
      const touch = event.changedTouches[0];
      const dy = touch ? pull.move(touch.clientY, event.timeStamp) : 0;
      const velocity = pull.velocity();
      pull = null;
      if (dragging && from === 'half') {
        const next = riseDock(follow(dy), velocity);
        const book = bookRef.current;
        if (book) glide(book);
        if (next !== latest.current.dock) latest.current.onDock(next);
      } else if (dragging) release(follow(dy), velocity);
      dragging = false;
    };
    const wheel = (event: WheelEvent) => {
      if (latest.current.dock !== 'half' || event.deltaY <= 0 || event.ctrlKey) return;
      event.preventDefault();
      latest.current.onDock('full');
    };
    body.addEventListener('touchstart', start, { passive: true });
    body.addEventListener('touchmove', move, { passive: false });
    body.addEventListener('touchend', end);
    body.addEventListener('touchcancel', end);
    body.addEventListener('wheel', wheel, { passive: false });
    return () => {
      body.removeEventListener('touchstart', start);
      body.removeEventListener('touchmove', move);
      body.removeEventListener('touchend', end);
      body.removeEventListener('touchcancel', end);
      body.removeEventListener('wheel', wheel);
    };
  }, [bodyRef, bookRef, enabled, follow, release]);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
