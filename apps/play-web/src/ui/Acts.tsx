// The action cards of the cultivation life (修仙人生, docs/gameplay-design.md 十四; the mock-up's .fx-acts):
// they take the options' place at the end of a beat. Each card is one button: the kind's character in
// a diamond, the title and a line of small words, and on the right the odds in brush (七成: jade when
// good, gold when middling, cinnabar when poor), 直行 for a card that rolls no die, or 不够格 for one
// out of reach, faded with a dashed diamond, its small words saying why. A card the engine classed by
// keywords (fallback) has no odds: its right side stays empty.
import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useRef } from 'react';
import type { ActionCard } from '../contracts';
import { chineseNumber } from '../lib/numerals';
import { cx } from './cx';
import { typingInto } from './Opts';
import styles from './Acts.module.css';

export interface ActsProps {
  items: ActionCard[];
  /** a card picked; without it the cards are only shown */
  onPick?: (card: ActionCard) => void;
  /** a turn is being written: nothing can be picked */
  disabled?: boolean;
  /** keys 1 to 5 pick the card of that number, unless a text field has focus */
  hotkeys?: boolean;
  /** the model gave no cards: the engine classed its options by keywords, none has odds */
  fallback?: boolean;
  className?: string;
}

/** The odds in words: 70 → 七成, 20 → 两成; under 5 → 渺茫 (a tenth would say too much). */
export function oddsWords(odds: number): string {
  if (odds < 5) return '渺茫';
  const tenths = Math.min(10, Math.round(odds / 10));
  return `${tenths === 2 ? '两' : chineseNumber(tenths)}成`;
}

/** What the right side of a card says: the odds, 直行, 不够格, or nothing (a fallback card). */
export function cardLook(card: ActionCard): 'locked' | 'plain' | 'priced' | 'bare' {
  if (card.locked) return 'locked';
  if (card.plain) return 'plain';
  return card.odds === undefined ? 'bare' : 'priced';
}

/** The small words under a locked card's title say why it is out of reach. */
function smallWords(card: ActionCard): string {
  if (!card.locked || !card.reason || card.sub.includes(card.reason)) return card.sub;
  return `${card.kind} · ${card.reason}`;
}

/** 「看魅力」「难度难」: what is looked at and how hard it is stand out a little (the mock-up's <b>). */
function marked(sub: string): ReactNode[] {
  return sub.split(' · ').flatMap((part, at) => {
    const lead = /^(看|难度)(.+)$/.exec(part);
    const shown = lead ? (
      <span key={at}>
        {lead[1]}
        <b>{lead[2]}</b>
      </span>
    ) : (
      <span key={at}>{part}</span>
    );
    return at === 0 ? [shown] : [' · ', shown];
  });
}

/** What a screen reader hears for a card: its title, its small words and its odds or why it cannot be picked. */
export function cardLabel(card: ActionCard): string {
  const look = cardLook(card);
  const end =
    look === 'locked'
      ? `不够格：${card.reason ?? card.sub}`
      : look === 'plain'
        ? '直行，不掷骰'
        : look === 'priced'
          ? `成算${oddsWords(card.odds ?? 0)}`
          : '';
  return [card.title, smallWords(card), end].filter(Boolean).join('，');
}

export function Acts({ items, onPick, disabled = false, hotkeys = false, fallback = false, className }: ActsProps) {
  const list = useRef<HTMLOListElement>(null);
  const press = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);

  useEffect(() => {
    if (!hotkeys || disabled || !onPick) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || typingInto(event.target)) return;
      const index = Number(event.key);
      if (!(index >= 1 && index <= 5)) return;
      const card = items.find((item) => item.index === index);
      if (!card) return;
      event.preventDefault();
      if (!card.locked) onPick(card);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hotkeys, disabled, items, onPick]);

  const onKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = [...(list.current?.querySelectorAll('button') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[(at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  // a finger that moved more than 10 px was scrolling the page, not picking (spec 三, 选项)
  const onPointerDown = (event: PointerEvent) => {
    press.current = { x: event.clientX, y: event.clientY };
    moved.current = false;
  };
  const onPointerMove = (event: PointerEvent) => {
    const start = press.current;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) moved.current = true;
  };

  return (
    <ol
      ref={list}
      className={cx(styles.acts, className)}
      aria-label="抉择"
      data-fallback={fallback ? '' : undefined}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
    >
      {items.map((card) => {
        const look = cardLook(card);
        // a locked card stays focusable, so that its reason is read out; it does nothing when pressed
        const inert = card.locked || !onPick;
        return (
          <li key={card.index}>
            <button
              type="button"
              className={styles.act}
              data-look={look}
              data-tone={look === 'priced' ? (card.tone ?? 'mid') : undefined}
              aria-label={cardLabel(card)}
              aria-disabled={inert || undefined}
              disabled={disabled}
              onClick={() => {
                if (moved.current || inert || disabled) return;
                onPick?.(card);
              }}
            >
              <span className={styles.kind} aria-hidden="true">
                <span>{card.glyph}</span>
              </span>
              <span className={styles.words}>
                <strong>{card.title}</strong>
                <small>{marked(smallWords(card))}</small>
              </span>
              <span className={styles.odds} aria-hidden="true">
                {look === 'priced' && (
                  <>
                    <i>成算</i>
                    <b>{oddsWords(card.odds ?? 0)}</b>
                  </>
                )}
                {look === 'plain' && <b>直行</b>}
                {look === 'locked' && <b>不够格</b>}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
