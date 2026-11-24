import { type ReactNode, useId, useRef } from 'react';
import { Btn } from './Btn';
import { cx } from './cx';
import { frameClass } from './Frame';
import { useFocusTrap } from './useFocusTrap';
import styles from './Dialog.module.css';

export interface DialogProps {
  open: boolean;
  title: string;
  /** what happens, in plain words; for irreversible acts, the consequence (「会作废之后的 3 个回合」) */
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  /** without it the dialog only informs and has one button */
  onCancel?: () => void;
  /** irreversible: the confirm button turns cinnabar */
  danger?: boolean;
  className?: string;
}

/**
 * A centred dialog over a veil (spec 三, 对话框 · new design). The confirm button is on the right,
 * nearest the thumb; Escape cancels.
 */
export function Dialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = '算了',
  onConfirm,
  onCancel,
  danger = false,
  className,
}: DialogProps) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useFocusTrap(box, open, onCancel ?? onConfirm);
  if (!open) return null;
  return (
    <div className={styles.layer}>
      <div className={styles.veil} aria-hidden="true" onClick={onCancel} />
      <div
        ref={box}
        className={cx(frameClass, styles.dialog, className)}
        data-ornate=""
        role={danger ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
      >
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <div id={bodyId} className={styles.body}>
          {children}
        </div>
        <div className={styles.actions}>
          {onCancel && <Btn onClick={onCancel}>{cancelLabel}</Btn>}
          <Btn variant={danger ? 'danger' : 'solid'} onClick={onConfirm}>
            {confirmLabel}
          </Btn>
        </div>
      </div>
    </div>
  );
}
