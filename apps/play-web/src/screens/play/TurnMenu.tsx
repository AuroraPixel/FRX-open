// A turn's menu (spec 五, 回合菜单): 重试 on the last turn only; 回到此处 on earlier ones (撤回 on the
// last), which first asks, saying how many turns it gives up; 复制正文. It opens from the 「⋯」 at
// the right of the turn's rule, or from a long press on the turn on phones. After a death in extreme
// mode the server has started the save over from its opening: until the save is read again no turn of
// the book can be written again or gone back to, and only 复制正文 is left.
import { useEffect, useRef } from 'react';
import { cx } from '../../ui/cx';
import { frameClass } from '../../ui/Frame';
import styles from './TurnMenu.module.css';

export type TurnMenuAction = 'retry' | 'undo' | 'copy';

export interface TurnMenuProps {
  /** the turn is the last one written */
  last: boolean;
  /** retry and undo need the turn to be finished and nothing else under way */
  busy: boolean;
  /** the book ends in a death: the save started over, its turns are gone from the server */
  ended?: boolean;
  onPick: (action: TurnMenuAction) => void;
  onClose: () => void;
}

export function TurnMenu({ last, busy, ended = false, onPick, onClose }: TurnMenuProps) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const menu = box.current;
    // the 「⋯」 that opened it: focus goes back there when the menu goes and leaves it nowhere (spec 十二),
    // so a dialog it opens (回到此处) gives it back there as well
    const opener = menu?.parentElement?.querySelector<HTMLElement>('[aria-haspopup="menu"]') ?? null;
    // the menu opens at the turn's rule; a long press low in a long turn (phones) opens it above the
    // text area, cut away by it, 重试 out of reach (实玩二, 第三十九回): the text comes to it
    menu?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    menu?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    const away = (event: PointerEvent) => {
      if (menu && !menu.contains(event.target as Node)) close.current();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close.current();
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const items = [...(menu?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        const at = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        event.preventDefault();
      }
    };
    document.addEventListener('pointerdown', away, true);
    menu?.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      menu?.removeEventListener('keydown', key);
      const lost = document.activeElement === null || document.activeElement === document.body;
      if (lost && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  const item = (action: TurnMenuAction, label: string, disabled = false) => (
    <button type="button" role="menuitem" className={styles.item} disabled={disabled} onClick={() => onPick(action)}>
      {label}
    </button>
  );

  return (
    <div ref={box} className={cx(frameClass, styles.menu)} role="menu" aria-label="这一回">
      {last && !ended && item('retry', '重试', busy)}
      {!ended && item('undo', last ? '撤回' : '回到此处', busy)}
      {item('copy', '复制正文')}
    </div>
  );
}
