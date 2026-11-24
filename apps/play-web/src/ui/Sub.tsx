import type { HTMLAttributes } from 'react';
import { cx } from './cx';
import styles from './Sub.module.css';

/** A gold section title followed by a line fading to the right (spec 三, 小标题). */
export function Sub({ className, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cx(styles.sub, className)} {...rest} />;
}
