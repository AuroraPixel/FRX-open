// The settings panel's controls (spec 七, 设置): a row with its name on the left and its control on
// the right; a slider that is a 1 px gold line with a small gold diamond; a switch that is text
// buttons side by side, the chosen one solid; an input that is a gold line under the words.
import { type CSSProperties, type InputHTMLAttributes, type ReactNode, useId } from 'react';
import { Btn } from '../../ui/Btn';
import { cx } from '../../ui/cx';
import styles from './Settings.module.css';

export interface RowProps {
  label: string;
  /** the value as words, after the name: 「17 px」 */
  value?: ReactNode;
  /** a line under the row saying what it does */
  hint?: ReactNode;
  /** the control takes the whole width under the name (sliders, inputs) */
  wide?: boolean;
  children: ReactNode;
  className?: string;
}

/** One setting: its name, maybe its value, its control. */
export function Row({ label, value, hint, wide = false, children, className }: RowProps) {
  return (
    <div className={cx(styles.row, className)} data-wide={wide ? '' : undefined}>
      <span className={styles.head}>
        <span className={styles.label}>{label}</span>
        {value !== undefined && <b className={styles.value}>{value}</b>}
      </span>
      <div className={styles.control}>{children}</div>
      {hint && <p className={styles.hint}>{hint}</p>}
    </div>
  );
}

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** the player let go: a good moment to save what was chosen */
  onCommit?: (value: number) => void;
  /** read out with the value: 「17 像素」 */
  valueText?: string;
  disabled?: boolean;
}

/** A slider: a 1 px gold line, brighter up to the value, with a small gold diamond (spec 七, 设置). */
export function Slider({ label, value, min, max, step = 1, onChange, onCommit, valueText, disabled }: SliderProps) {
  const share = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const commit = (event: { currentTarget: HTMLInputElement }) => onCommit?.(Number(event.currentTarget.value));
  return (
    <input
      type="range"
      className={styles.slider}
      aria-label={label}
      aria-valuetext={valueText}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      style={{ '--fill': `${share.toFixed(1)}%` } as CSSProperties}
      onChange={(event) => onChange(Number(event.currentTarget.value))}
      onPointerUp={commit}
      onKeyUp={commit}
    />
  );
}

export interface ChoiceProps<T extends string> {
  /** read out for the group: 「动效」 */
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}

/** Text buttons side by side, the chosen one solid: 全 弱 关, 开 关 (spec 七, 设置 · 开关). */
export function Choice<T extends string>({ label, options, value, onChange, disabled }: ChoiceProps<T>) {
  return (
    <div className={styles.choice} role="group" aria-label={label}>
      {options.map((option) => (
        <Btn
          key={option.id}
          variant={option.id === value ? 'solid' : 'line'}
          aria-pressed={option.id === value}
          disabled={disabled}
          onClick={() => option.id !== value && onChange(option.id)}
        >
          {option.label}
        </Btn>
      ))}
    </div>
  );
}

export const ON_OFF = [
  { id: 'on', label: '开' },
  { id: 'off', label: '关' },
] as const;

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** said under the line: why it was refused, what it keeps */
  note?: ReactNode;
  /** the note is a refusal */
  wrong?: boolean;
}

/** A text input: its name above, a gold line under the words that brightens with focus. */
export function Field({ label, value, onChange, note, wrong = false, className, ...rest }: FieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  return (
    <div className={cx(styles.field, className)}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        aria-invalid={wrong || undefined}
        aria-describedby={note ? noteId : undefined}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        {...rest}
      />
      {note && (
        <span id={noteId} className={styles.fieldNote} data-wrong={wrong ? '' : undefined}>
          {note}
        </span>
      )}
    </div>
  );
}
