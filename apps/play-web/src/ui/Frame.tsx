import type { HTMLAttributes } from 'react';
import { cx } from './cx';
import styles from './Frame.module.css';

/**
 * The panel frame (spec 三, 面板框): a translucent gradient over a blurred picture, a soft border and
 * two gold corner folds. Sheets and dialogs are built on it.
 */
export function Frame({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx(styles.frame, className)} {...rest} />;
}

export const frameClass = styles.frame;

/**
 * The frames' backdrop blur is the dearest thing the page draws over the moving stage. Once the stage has had to
 * lower its resolution because frames came too slowly (spec 九, 性能上的规矩: its `onSlower`), the blur goes off for
 * the rest of the visit: the root element gets data-blur="off" and the frames turn more opaque instead
 * (Frame.module.css).
 */
export function blurOff(root: HTMLElement = document.documentElement): void {
  root.dataset.blur = 'off';
}
