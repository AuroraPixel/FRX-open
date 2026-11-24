import { type PointerEvent as ReactPointerEvent, type RefObject, useCallback, useEffect, useRef } from 'react';
import { type SheetSizes, type SheetStop, Tracker, settleFit, settleSheet } from './drag';

export interface SheetDragOptions {
  /** Phones only; on desktops the sheet is a side panel and does not drag. */
  enabled: boolean;
  stop: SheetStop;
  onStop: (stop: SheetStop) => void;
  onClose: () => void;
  /** as tall as its content (the navigation): it never grows; it follows the finger down and closes */
  fit?: boolean;
}

/** The phone sheet's two heights for the current screen (spec 三, 面板). */
export function sheetSizes(viewport = globalThis.visualViewport?.height ?? globalThis.innerHeight): SheetSizes {
  return { open: Math.min(viewport * 0.72, 560), full: viewport * 0.92 };
}

/**
 * Drags the phone's bottom sheet (spec 十一, 面板): the header pulls it up to 92dvh or down to
 * close; in the body a downward pull only takes over once the content is scrolled to the top.
 * During the drag the sheet's style is written directly, so React does not re-render per move.
 *
 * The header uses pointer events with touch-action: none. The body needs touch events: whether a
 * downward pull scrolls or drags is only known after it starts, and only a non-passive touchmove can
 * still cancel the scroll then.
 */
export function useSheetDrag(
  sheetRef: RefObject<HTMLElement | null>,
  bodyRef: RefObject<HTMLElement | null>,
  { enabled, stop, onStop, onClose, fit = false }: SheetDragOptions,
) {
  const tracker = useRef<Tracker | null>(null);
  const latest = useRef({ stop, onStop, onClose, fit });
  latest.current = { stop, onStop, onClose, fit };

  const follow = useCallback(
    (dy: number) => {
      const sheet = sheetRef.current;
      if (!sheet) return;
      sheet.style.transition = 'none';
      if (latest.current.fit) {
        sheet.style.transform = dy > 0 ? `translateY(${dy}px)` : '';
        return;
      }
      const sizes = sheetSizes();
      const start = latest.current.stop === 'full' ? sizes.full : sizes.open;
      if (dy < 0) {
        sheet.style.height = `${Math.min(sizes.full, start - dy)}px`;
        sheet.style.transform = '';
      } else {
        sheet.style.height = `${start}px`;
        sheet.style.transform = `translateY(${dy}px)`;
      }
    },
    [sheetRef],
  );

  const release = useCallback(
    (dy: number, velocity: number) => {
      const sheet = sheetRef.current;
      const { stop: from, onStop: settle, onClose: close, fit: fits } = latest.current;
      if (!sheet) return;
      const next = fits ? settleFit(dy, velocity, sheet.offsetHeight) : settleSheet(from, dy, velocity, sheetSizes());
      sheet.style.transition = '';
      if (next === 'close') {
        sheet.style.transform = 'translateY(110%)';
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          close();
        };
        sheet.addEventListener('transitionend', finish, { once: true });
        setTimeout(finish, 500);
        return;
      }
      sheet.style.height = '';
      sheet.style.transform = '';
      if (!fits && next !== from) settle(next);
    },
    [sheetRef],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || event.button !== 0) return;
      // the header's own buttons (回, 合) stay buttons
      if (event.target instanceof Element && event.target.closest('button, a, input, textarea, select')) return;
      tracker.current = new Tracker(event.clientY, event.timeStamp);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [enabled],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!tracker.current) return;
      follow(tracker.current.move(event.clientY, event.timeStamp));
    },
    [follow],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const track = tracker.current;
      if (!track) return;
      tracker.current = null;
      const dy = track.move(event.clientY, event.timeStamp);
      // a tap on the handle toggles between open and full (a sheet as tall as its content has one place)
      if (Math.abs(dy) < 6) {
        if (!latest.current.fit) latest.current.onStop(latest.current.stop === 'full' ? 'open' : 'full');
        return;
      }
      release(dy, track.velocity());
    },
    [release],
  );

  const onPointerCancel = useCallback(() => {
    if (!tracker.current) return;
    tracker.current = null;
    release(0, 0);
  }, [release]);

  // the body: a downward pull at the top of the content drags the sheet instead of scrolling
  useEffect(() => {
    const body = bodyRef.current;
    if (!enabled || !body) return;
    let pull: Tracker | null = null;
    let atTop = false;
    let dragging = false;
    const start = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch || event.touches.length > 1) return;
      pull = new Tracker(touch.clientY, event.timeStamp);
      atTop = body.scrollTop <= 0;
      dragging = false;
    };
    const move = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!pull || !touch) return;
      const dy = pull.move(touch.clientY, event.timeStamp);
      if (!dragging && atTop && dy > 6) dragging = true;
      if (!dragging) {
        if (dy < 0) atTop = false;
        return;
      }
      event.preventDefault();
      follow(Math.max(0, dy));
    };
    const end = (event: TouchEvent) => {
      if (!pull) return;
      const touch = event.changedTouches[0];
      const dy = touch ? pull.move(touch.clientY, event.timeStamp) : 0;
      const velocity = pull.velocity();
      pull = null;
      if (dragging) release(Math.max(0, dy), velocity);
      dragging = false;
    };
    body.addEventListener('touchstart', start, { passive: true });
    body.addEventListener('touchmove', move, { passive: false });
    body.addEventListener('touchend', end);
    body.addEventListener('touchcancel', end);
    return () => {
      body.removeEventListener('touchstart', start);
      body.removeEventListener('touchmove', move);
      body.removeEventListener('touchend', end);
      body.removeEventListener('touchcancel', end);
    };
  }, [bodyRef, enabled, follow, release]);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
