import type { ReactNode } from 'react';
import common from './common.module.css';

export interface Row {
  label: string;
  value: ReactNode;
}

/**
 * Facts one to a line, for values too long for the two-column key-value table: a reward, the
 * condition of the next realm. The same look as the table: the name soft, the value bold, a dashed
 * line under each.
 */
export function Rows({ rows, className }: { rows: (Row | null | undefined | false)[]; className?: string }) {
  const shown = rows.filter((row): row is Row => Boolean(row));
  if (shown.length === 0) return null;
  return (
    <dl className={className ? `${common.rows} ${className}` : common.rows}>
      {shown.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
