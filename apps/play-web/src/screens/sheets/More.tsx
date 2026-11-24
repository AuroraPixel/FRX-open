import type { ReactNode } from 'react';
import { useReveal } from './reveal';
import common from './common.module.css';

/** What opens under a picked entry, brought into sight in the panel's scrolling body. */
export function More({ id, children }: { id: string; children: ReactNode }) {
  const ref = useReveal<HTMLDivElement>(id);
  return (
    <div id={id} ref={ref} className={common.more}>
      {children}
    </div>
  );
}
