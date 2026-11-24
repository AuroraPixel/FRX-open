// The mark across the book page where a scene of the cultivation life opens or closes (the mock-up's
// .fx-mark): 「遭遇」 or 「收场」 in gold and the scene's name, between two gold lines that fade out. In the
// life's book a scene is one 回 (章回, gameplay plan item 38): its opening mark has 「第十二回」 over it,
// and its close is followed by the 回 and its 回目 in brush, two lines side by side (one over the other
// where the page is narrow), over a short gold rule (the mock-up's .fx-couplet).
import { chapterWords, coupletLines } from '../lib/book';
import { cx } from './cx';
import styles from './SceneMark.module.css';

export interface SceneMarkProps {
  kind: 'open' | 'close';
  /** the scene's name: 「石阶上的来客」 */
  title: string;
  /** the life's book: the scene's 回 */
  chapter?: number;
  /** the life's book, at the close: the 回目 (「观云台月下问丹　玄微子石阶许诺」, or the engine's one line) */
  couplet?: string;
  className?: string;
}

export const SCENE_WORD = { open: '遭遇', close: '收场' } as const;

export function SceneMark({ kind, title, chapter, couplet, className }: SceneMarkProps) {
  const book = Boolean(chapter) || Boolean(couplet);
  const row = (
    <p className={cx(styles.mark, !book && className)} data-kind={kind}>
      <span>{SCENE_WORD[kind]}</span>
      <em>{title}</em>
    </p>
  );
  if (!book) return row;
  const hui = chapter ? chapterWords(chapter) : null;
  const lines = couplet ? coupletLines(couplet) : [];
  return (
    <div className={cx(styles.chapter, className)} data-kind={kind}>
      {kind === 'open' && hui && <b className={styles.hui}>{hui}</b>}
      {row}
      {kind === 'close' && (
        <p className={styles.title}>
          {hui && <b className={styles.hui}>{hui}</b>}
          {lines.length > 0 && (
            <span className={styles.couplet}>
              {lines.map((line, at) => (
                <span key={at}>
                  {/* read out with a pause between the two lines */}
                  {at > 0 && <span className="visually-hidden">，</span>}
                  {line}
                </span>
              ))}
            </span>
          )}
          <i aria-hidden="true" />
        </p>
      )}
    </div>
  );
}
