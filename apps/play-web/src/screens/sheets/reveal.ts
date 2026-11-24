import { useEffect, useRef } from 'react';

/**
 * Brings what a pick opened into sight inside the panel's scrolling body (a phone's sheet is short:
 * a detail under a long grid would open out of view). Smooth unless motion is turned down or the
 * page's clock is pinned for a screenshot.
 */
export function useReveal<T extends HTMLElement>(key: string | null) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const element = ref.current;
    if (key === null || !element || typeof element.scrollIntoView !== 'function') return;
    const root = document.documentElement;
    const still =
      root.dataset.pinned !== undefined ||
      root.dataset.motion !== undefined ||
      globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    element.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
  }, [key]);
  return ref;
}
