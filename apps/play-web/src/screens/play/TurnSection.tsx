// One turn on the book page: the rule with 「第 N 回」 and its 「⋯」 menu, then the turn's page of
// rows. The page of the turn being read is at least as tall as the text area, so the player's stroke
// can always rest at the top of it.
import type { ReactNode } from 'react';
import type { Block, NarrationBlock } from '../../contracts';
import { turnWords } from '../../lib/book';
import { chapterTitle } from '../../lib/numerals';
import { cx } from '../../ui/cx';
import { Tool } from '../../ui/Tool';
import type { AnnalPlace } from './life';
import { TurnMenu, type TurnMenuAction } from './TurnMenu';
import { TurnView } from './TurnView';
import { useLongPress } from './useLongPress';
import styles from './Book.module.css';

export interface TurnSectionProps {
  no: number;
  blocks: Block[];
  open?: NarrationBlock | null;
  cancelled?: boolean;
  /** the turn being read now: the last one */
  current: boolean;
  delays?: ReadonlyMap<string, number>;
  /** cards held back until their performance lands them, and fights' last cards with their verdict */
  held?: ReadonlySet<string>;
  verdicts?: ReadonlySet<string>;
  /** the menu can be opened: a finished turn */
  menu?: {
    last: boolean;
    busy: boolean;
    /** the book ends in a death: only 复制正文 is left (TurnMenu) */
    ended?: boolean;
    open: boolean;
    onOpen: () => void;
    onClose: () => void;
    onPick: (action: TurnMenuAction) => void;
  };
  /** what follows the rows in the turn being read: waiting, a failure, options on phones */
  children?: ReactNode;
  /** the cultivation life: a turn of days the engine settled alone, in a run of them (life.tsx) */
  annal?: AnnalPlace;
  /**
   * the cultivation life's book (章回, gameplay plan item 38): a scene is one 回, not a turn, so the
   * turn's rule has no 「第 N 回」 (the scene's marks and the book's head say the 回)
   */
  book?: boolean;
}

export function TurnSection({ no, blocks, open, cancelled, current, delays, held, verdicts, menu, children, annal, book = false }: TurnSectionProps) {
  const press = useLongPress(() => menu?.onOpen());
  const name = turnWords(no, book);
  return (
    <section
      className={cx(styles.turn, current && styles.current)}
      data-turn={no}
      data-current={current ? '' : undefined}
      data-annal={annal ? '' : undefined}
      data-joined={annal?.joined ? '' : undefined}
      data-folded={annal?.folded ? '' : undefined}
      data-book={book ? '' : undefined}
      aria-label={name}
    >
      <header className={styles.rule}>
        {!book && <span className={styles.ruleNo}>{chapterTitle(no)}</span>}
        <i className={styles.ruleLine} aria-hidden="true" />
        {menu && (
          <span className={styles.ruleMenu} data-open={menu.open ? '' : undefined}>
            <Tool
              glyph="⋯"
              label={`${name}：${menu.ended ? '复制' : menu.last ? '重试、撤回、复制' : '回到此处、复制'}`}
              aria-haspopup="menu"
              aria-expanded={menu.open}
              className={styles.more}
              onClick={() => (menu.open ? menu.onClose() : menu.onOpen())}
            />
            {menu.open && <TurnMenu last={menu.last} busy={menu.busy} ended={menu.ended} onPick={menu.onPick} onClose={menu.onClose} />}
          </span>
        )}
      </header>
      <div className={styles.page} data-page="">
        <div className={styles.rows} {...(menu ? press : {})}>
          <TurnView no={no} blocks={blocks} open={open} cancelled={cancelled} delays={delays} held={held} verdicts={verdicts} />
        </div>
        {children}
        {current && <i className={styles.end} data-end="" aria-hidden="true" />}
      </div>
    </section>
  );
}
