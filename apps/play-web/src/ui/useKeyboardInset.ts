import { useEffect, useState } from 'react';

/** How much of the layout viewport's bottom the on-screen keyboard covers, in CSS pixels. */
export function keyboardInset(
  layoutHeight: number,
  viewport: { height: number; offsetTop: number } | null | undefined,
): number {
  if (!viewport) return 0;
  const covered = layoutHeight - (viewport.height + viewport.offsetTop);
  // ignore the browser chrome wobbling by a few pixels
  return covered > 24 ? Math.round(covered) : 0;
}

/**
 * Keeps the phone's bottom bar on the keyboard's top edge (spec 十一, 软键盘). Browsers that resize
 * the page for the keyboard (interactive-widget=resizes-content) report 0; iOS Safari does not, so
 * the visual viewport's height and offset say where the keyboard begins.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = globalThis.visualViewport;
    if (!viewport) return;
    const update = () => setInset(keyboardInset(globalThis.innerHeight, viewport));
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);
  return inset;
}
