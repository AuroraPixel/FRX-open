// The book page (spec 四, 书页; 五; 十一): the head with the chapter, the place and the day; the text,
// the only part that scrolls, with the turns one after another and the reading thread at the right;
// the foot with the options, the queued chips and the player's own line. On phones the page docks
// half or fully open, the options follow the text, and the bottom bar takes the foot's place.
import { type KeyboardEvent, type PointerEventHandler, type ReactNode, type Ref, forwardRef } from 'react';
import { chapterWords, volumeWords } from '../../lib/book';
import { chapterTitle } from '../../lib/numerals';
import { Loading } from '../../ui/Loading';
import { Scroll } from '../../ui/Scroll';
import styles from './Book.module.css';

export interface BookHead {
  no: number;
  title: string;
  /** 「正月初三 · 子时」, desktops only */
  when: string;
  /** phones, fully open: the one on stage, as a small round head */
  face?: { src: string; name: string };
  /**
   * the cultivation life's book (章回, gameplay plan item 38): the head writes the 回 under way (a scene
   * is one 回; 楔子 before the first) instead of the turn's number, and at its right the volume, which
   * opens the contents (目录)
   */
  book?: { chapter: number; volume: number; onContents: () => void };
}

export interface DockHandlers {
  onPointerDown: PointerEventHandler<HTMLElement>;
  onPointerMove: PointerEventHandler<HTMLElement>;
  onPointerUp: PointerEventHandler<HTMLElement>;
  onPointerCancel: PointerEventHandler<HTMLElement>;
}

export interface BookProps {
  head: BookHead;
  /** phones: the head drags the page between its docking places; a tap or Enter switches */
  dock?: { handlers: DockHandlers; toggle: () => void };
  scrollRef: Ref<HTMLDivElement>;
  /** earlier turns are being fetched above */
  loadingEarlier: boolean;
  /** the turn sections */
  children: ReactNode;
  /** 「新的内容 ↓」 */
  behind: boolean;
  onToEnd: () => void;
  /** phones: the options are out of view, 「抉择 · 3 ↓」 */
  choices?: { count: number; onShow: () => void } | null;
  /** desktops: options, chips and the line; phones leave it out */
  foot?: ReactNode;
  /** a finger on a desktop layout with a panel over part of the page: it waits, faded and not pressable */
  held?: boolean;
}

/**
 * A title in the brush, its 「·」 in the serif face: the brush's cut has no middle dot, and a place on the
 * map is often 「泊灯城·云水居客房」.
 */
export function brushTitle(title: string): ReactNode {
  if (!title.includes('·')) return title;
  return title.split('·').flatMap((part, at) => (at === 0 ? [part] : [<span key={at} className={styles.dot}>·</span>, part]));
}

export const Book = forwardRef(function Book(
  { head, dock, scrollRef, loadingEarlier, children, behind, onToEnd, choices, foot, held = false }: BookProps,
  ref: Ref<HTMLElement>,
) {
  const toggleKeys = (event: KeyboardEvent) => {
    if (!dock || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    dock.toggle();
  };
  const hui = head.book ? chapterWords(head.book.chapter) : chapterTitle(head.no);
  return (
    <article
      ref={ref}
      className={styles.book}
      aria-label="书页"
      data-volume={head.book ? '' : undefined}
      data-held={held ? '' : undefined}
      data-disabled-look={held ? '' : undefined}
      inert={held || undefined}
    >
      <header
        className={styles.head}
        {...(dock
          ? {
              ...dock.handlers,
              role: 'button',
              tabIndex: 0,
              'aria-label': `${hui} · ${head.title}：展开或收起书页`,
              onKeyDown: toggleKeys,
            }
          : {})}
      >
        <span className={styles.hui}>{hui}</span>
        <h1 className={styles.ti}>{brushTitle(head.title)}</h1>
        <span className={styles.when}>{head.when}</span>
        {head.face && <img className={styles.face} src={head.face.src} alt={head.face.name} />}
      </header>
      {/* beside the head, not in it: on phones the head is the page's handle (a button of its own) */}
      {head.book && (
        <button type="button" className={styles.volume} onClick={head.book.onContents} aria-label={`${volumeWords(head.book.volume)}：目录`}>
          {volumeWords(head.book.volume)}
        </button>
      )}
      <div className={styles.text}>
        {/* not a live region: what is new is said by the page's own (useAnnounce), not every earlier
            turn fetched above or every word of a paragraph being written */}
        <Scroll scrollRef={scrollRef} className={styles.body} thread fade aria-label="正文">
          <div className={styles.pages}>{children}</div>
        </Scroll>
        {/* over the text, not in it: earlier turns arriving must not push what is being read */}
        {loadingEarlier && <Loading text="翻出更早的回合……" className={styles.earlier} />}
        <div className={styles.floats}>
          {behind ? (
            <button type="button" className={styles.float} onClick={onToEnd}>
              新的内容 ↓
            </button>
          ) : (
            choices && (
              <button type="button" className={styles.float} onClick={choices.onShow}>
                抉择 · {choices.count} ↓
              </button>
            )
          )}
        </div>
      </div>
      {foot && <footer className={styles.foot}>{foot}</footer>}
    </article>
  );
});
