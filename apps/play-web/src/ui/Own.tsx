import { type ChangeEvent, type KeyboardEvent, type Ref, useLayoutEffect, useRef } from 'react';
import { cx } from './cx';
import { Gem } from './Gem';
import styles from './Own.module.css';

export interface OwnProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  inputRef?: Ref<HTMLTextAreaElement>;
  /** chips wait above the line: sending with no words of one's own sends them alone */
  allowEmpty?: boolean;
  className?: string;
}

const MAX_LINES = 4;

/**
 * The player's own action (spec 三, 输入): FangSong, grows with the text up to four lines. Enter
 * sends and Shift+Enter breaks the line; while an input method is composing, Enter belongs to it.
 * Desktops show a 回车 key cap, phones a send diamond.
 */
export function Own({
  id,
  value,
  onChange,
  onSend,
  disabled = false,
  placeholder = '或者，写下你自己的行动……',
  onFocus,
  onBlur,
  inputRef,
  allowEmpty = false,
  className,
}: OwnProps) {
  const area = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    const style = getComputedStyle(el);
    const line = parseFloat(style.lineHeight) || 22;
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    el.style.height = `${Math.min(el.scrollHeight, line * MAX_LINES + padding)}px`;
  }, [value]);

  const send = () => {
    const text = value.trim();
    if ((text || allowEmpty) && !disabled) onSend(text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    send();
  };

  const setRef = (el: HTMLTextAreaElement | null) => {
    area.current = el;
    if (typeof inputRef === 'function') inputRef(el);
    else if (inputRef) inputRef.current = el;
  };

  return (
    <div className={cx(styles.own, className)}>
      <textarea
        id={id}
        ref={setRef}
        className={styles.input}
        rows={1}
        value={value}
        placeholder={placeholder}
        aria-label="写下你的行动"
        enterKeyHint="send"
        disabled={disabled}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      <kbd className={styles.key} aria-hidden="true">
        回车
      </kbd>
      <Gem className={styles.send} icon="send" label="发送" labelMode="none" disabled={disabled || (!value.trim() && !allowEmpty)} onClick={send} />
    </div>
  );
}
