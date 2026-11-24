import type { ReactNode } from 'react';
import { cx } from './cx';
import styles from './Detail.module.css';

export interface DetailProps {
  title: string;
  /** type and quality: 「丹药 · 良品」 */
  meta?: string;
  children?: ReactNode;
  /** text buttons along the bottom */
  actions?: ReactNode;
  className?: string;
}

/** The detail block under a grid of slots (spec 三, 详情块). */
export function Detail({ title, meta, children, actions, className }: DetailProps) {
  return (
    <section className={cx(styles.detail, className)} aria-label={title}>
      <strong className={styles.title}>{title}</strong>
      {meta && <span className={styles.meta}>{meta}</span>}
      {children && <div className={styles.text}>{children}</div>}
      {actions && <div className={styles.actions}>{actions}</div>}
    </section>
  );
}
