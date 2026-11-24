import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { cx } from './cx';
import type { SheetStop } from './drag';
import { frameClass } from './Frame';
import { Tool } from './Tool';
import { useFocusTrap } from './useFocusTrap';
import { PHONE, useMedia } from './useMedia';
import { useSheetDrag } from './useSheetDrag';
import styles from './Sheet.module.css';

export interface SheetProps {
  title: string;
  /** a few small words after the title (the gate's sheet: 「筑基」 then 「冲关准备」) */
  subtitle?: string;
  open: boolean;
  onClose: () => void;
  /** Phones: the 回 button back to the navigation grid */
  onBack?: () => void;
  /** wide: the map's wider side panel on desktops; tall: always 92dvh on phones */
  size?: 'normal' | 'wide' | 'tall';
  /** phones: the content is stretched to the body's full height (the map lays itself out in it) */
  fill?: boolean;
  /** phones: as tall as its content, with one place (the navigation): it is pulled down to close */
  fit?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * The panel (spec 三, 面板): a side panel on desktops, a bottom sheet with a drag handle and a scrim
 * on phones. Focus stays inside while it is open; Escape and 合 close it.
 */
export function Sheet({ title, subtitle, open, onClose, onBack, size = 'normal', fill = false, fit = false, children, className }: SheetProps) {
  const phone = useMedia(PHONE);
  const sheetRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [stop, setStop] = useState<SheetStop>(size === 'tall' ? 'full' : 'open');

  useEffect(() => {
    if (open) setStop(size === 'tall' ? 'full' : 'open');
  }, [open, size]);

  useFocusTrap(sheetRef, open, onClose);
  const drag = useSheetDrag(sheetRef, bodyRef, {
    enabled: phone && open,
    stop,
    onStop: size === 'tall' ? () => {} : setStop,
    onClose,
    fit,
  });

  if (!open) return null;
  return (
    <div className={styles.layer} data-size={size}>
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
      <section
        ref={sheetRef}
        className={cx(frameClass, styles.sheet, className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-stop={stop}
        tabIndex={-1}
      >
        <header className={styles.head} {...drag}>
          <span className={styles.handle} aria-hidden="true" />
          {onBack && <Tool glyph="回" label="返回" onClick={onBack} className={styles.back} />}
          <h2 id={titleId} className={styles.title}>
            {title}
            {subtitle && <small>{subtitle}</small>}
          </h2>
          <Tool glyph="合" label="关闭" onClick={onClose} />
        </header>
        <div ref={bodyRef} className={styles.body} data-fill={fill ? '' : undefined}>
          {children}
        </div>
      </section>
    </div>
  );
}
