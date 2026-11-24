import { useEffect } from 'react';

/**
 * Marks the page as drawn (data-ready on the root) once its data is in, so the screenshot tool
 * knows when to take the picture.
 */
export function useReady(ready: boolean): void {
  useEffect(() => {
    const root = document.documentElement;
    if (!ready) return;
    root.dataset.ready = '';
    return () => {
      delete root.dataset.ready;
    };
  }, [ready]);
}
