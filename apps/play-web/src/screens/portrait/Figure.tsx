import { useEffect, useRef, useState } from 'react';
import type { Recipe } from '../../contracts';
import { cropBox, useKit } from '../../kit/shared';
import { cx } from '../../ui/cx';
import styles from './Portrait.module.css';

export interface FigureProps {
  recipe: Recipe;
  /** half: head to waist (the person page, the maker); full: the whole figure (the creation's preview) */
  crop?: 'half' | 'full';
  /** read out in place of the picture: 「白蘅的半身像」 */
  label: string;
  /** told once the recipe on show is drawn (screenshots wait for it) */
  onDrawn?: () => void;
  className?: string;
}

/** Drawn at this scale of the kit's 1086 × 1448 canvas: sharp at 440 px tall on 2× screens. */
const SCALE = { half: 0.56, full: 0.5 } as const;

/**
 * A portrait composed by the kit on a canvas of the page (not the stage): it follows every change of the
 * recipe, the last change winning, and keeps the old picture until the new one is drawn.
 */
export function Figure({ recipe, crop = 'half', label, onDrawn, className }: FigureProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const kit = useKit();
  const key = JSON.stringify(recipe);
  const [drawnKey, setDrawnKey] = useState<string | null>(null);
  const told = useRef(onDrawn);
  told.current = onDrawn;

  useEffect(() => {
    if (!kit) return;
    let live = true;
    const scale = SCALE[crop];
    kit
      .compose(recipe, scale)
      .then((figure) => {
        const canvas = ref.current;
        if (!live || !canvas) return;
        const [x, y, w, h] = cropBox(kit, recipe, crop);
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const g = canvas.getContext('2d');
        if (!g) return;
        g.imageSmoothingQuality = 'high';
        g.drawImage(figure, x * scale, y * scale, w * scale, h * scale, 0, 0, canvas.width, canvas.height);
        setDrawnKey(key);
        told.current?.();
      })
      .catch(() => {
        // a part the kit cannot find: the last picture stays
        if (!live) return;
        setDrawnKey(key);
        told.current?.();
      });
    return () => {
      live = false;
    };
    // the key stands for the recipe
  }, [kit, key, crop]);

  return (
    <>
      <canvas
        ref={ref}
        className={cx(styles.figure, className)}
        data-crop={crop}
        data-drawn={drawnKey === key ? '' : undefined}
        role="img"
        aria-label={label}
      />
      {/* still being drawn: pages that wait for their pictures (the panels' screenshot page) see it */}
      {drawnKey !== key && <span role="status" hidden />}
    </>
  );
}
