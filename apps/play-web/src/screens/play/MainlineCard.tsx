// 主线 (the first playtest: the main line was never on the page): a card at the end of the days, before
// the next gate's, and under a scene's close card: the chapter (「第一章 · 市井谋生」) and its goal, each
// condition with what it has of what it wants (灵石 5 / 20, a thin bar under it) or a filled diamond when
// met, and the next chapter's title, greyed. Pressed whole, it opens the quests panel.
import type { Clue, Mainline } from '../../contracts';
import styles from './MainlineCard.module.css';

/** 「5 / 20」 for a counted condition, else nothing. */
export function clueCount(clue: Clue): string {
  return clue.have !== undefined && clue.need !== undefined ? `${Math.min(clue.have, clue.need)} / ${clue.need}` : '';
}

/** What a screen reader hears of a condition's progress. */
export function clueWords(clue: Clue): string {
  if (clue.done) return '已达成';
  if (clue.pending) return '待核验';
  return clue.have !== undefined && clue.need !== undefined ? `已有${Math.min(clue.have, clue.need)}，要${clue.need}` : '未达成';
}

/** What a screen reader hears for the card. */
export function mainlineLabel(line: Mainline): string {
  const goal = line.goal.replace(/[。！!.]+$/, '');
  const clues = line.clues.map((clue) => `${clue.text}，${clueWords(clue)}`).join('；');
  return `主线 · ${line.title ? `${line.title} · ` : ''}${line.chapter}：${goal}${clues ? `。${clues}` : ''}${line.next ? `。下一章 ${line.next}` : ''}。打开任务`;
}

export function MainlineCard({ line, onOpen }: { line: Mainline; onOpen: () => void }) {
  return (
    <button type="button" className={styles.card} aria-label={mainlineLabel(line)} onClick={onOpen}>
      {/* an emblem, as a seal is (the contrast check holds it to the 3:1 of graphics) */}
      <span className={styles.kind} aria-hidden="true" data-mark="">
        <span>主</span>
      </span>
      <span className={styles.words} aria-hidden="true">
        <strong>
          <small>{line.title || '主线'}</small>
          {line.chapter}
        </strong>
        {line.goal && <span className={styles.goal}>{line.goal}</span>}
        {line.clues.map((clue, at) => {
          const count = clueCount(clue);
          const share = clue.have !== undefined && clue.need ? Math.min(1, clue.have / clue.need) : 0;
          return (
            <span key={at} className={styles.clue} data-done={clue.done ? '' : undefined}>
              <span className={styles.text}>{clue.text}</span>
              {clue.pending && <span>待核验</span>}
              {count && !clue.done && (
                <span className={styles.count}>
                  <b>{count}</b>
                  <span className={styles.track}>
                    <i style={{ width: `${(share * 100).toFixed(2)}%` }} />
                  </span>
                </span>
              )}
            </span>
          );
        })}
        {line.next && <em className={styles.next}>下一章 · {line.next.replace(/^第[一二三四五六七八九十百]+章\s*·\s*/, '')}</em>}
      </span>
    </button>
  );
}
