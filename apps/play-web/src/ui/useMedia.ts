import { useSyncExternalStore } from 'react';

/**
 * The spec's phone layout (sections 四 and 十一): narrower than 760 px and held upright. A phone on its
 * side (wider than 13 : 10) takes the desktop's compact layout instead; a phone upright with its keyboard
 * open stays a phone (390 × 420 is 1 : 1.08). Every style sheet's phone rules use the same query.
 */
export const PHONE = '(max-width: 759px) and (max-aspect-ratio: 13/10)';

/** The spec's short screen (section 四, 矮屏): lower than 560 px, as a phone on its side is. */
export const SHORT = '(max-height: 559px)';

/** A finger points (a phone, a tablet): what it presses is 44 px, and nothing is pressed half covered. */
export const FINGER = '(pointer: coarse)';

/** Whether a media query matches, kept up to date. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof matchMedia !== 'function') return () => {};
      const list = matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    () => (typeof matchMedia === 'function' ? matchMedia(query).matches : false),
    () => false,
  );
}
