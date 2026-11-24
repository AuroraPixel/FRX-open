import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
} from 'react';

/** A press counts as long after 450 ms with the finger moving no more than 10 px (spec 十一, 触控). */
export const LONG_PRESS_MS = 450;
const SLOP = 10;

/**
 * The click a browser sends when the finger lifts lands wherever it is, perhaps on the menu the long
 * press just opened under it: a click in the moment after the lift is swallowed, wherever it lands.
 * Returns what to call when the finger lifts.
 */
function swallowClick(): () => void {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    done();
  };
  const done = () => {
    document.removeEventListener('click', swallow, true);
    clearTimeout(fallback);
  };
  // a lift that never comes (the finger slid off the page) still lets clicks through again
  const fallback = setTimeout(done, 2000);
  document.addEventListener('click', swallow, true);
  return () => setTimeout(done, 350);
}

/**
 * Long-press on touch screens: calls `onLong` once the finger has rested long enough; the click and
 * the browser's own menu that would follow are swallowed. Mouse presses are left alone.
 */
export function useLongPress(onLong: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const lifted = useRef<(() => void) | null>(null);
  const latest = useRef(onLong);
  latest.current = onLong;

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);

  useEffect(() => clear, [clear]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === 'mouse' || event.isPrimary === false) return;
      clear();
      fired.current = false;
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        lifted.current = swallowClick();
        latest.current();
      }, LONG_PRESS_MS);
    },
    [clear],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const from = start.current;
      if (from && Math.hypot(event.clientX - from.x, event.clientY - from.y) > SLOP) clear();
    },
    [clear],
  );

  const onPointerUp = useCallback(() => {
    clear();
    lifted.current?.();
    lifted.current = null;
  }, [clear]);

  const onContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (fired.current || timer.current) event.preventDefault();
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onContextMenu };
}
