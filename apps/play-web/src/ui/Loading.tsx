import { cx } from './cx';
import styles from './Loading.module.css';

/**
 * Waiting (spec 三, 加载与空状态 · new design): a small gold diamond turning slowly and a faint line
 * of text. No progress bars, no spinners.
 */
export function Loading({ text = '提笔中……', className }: { text?: string; className?: string }) {
  return (
    <div className={cx(styles.loading, className)} role="status">
      <i className={styles.diamond} aria-hidden="true" data-endless="" />
      <span>{text}</span>
    </div>
  );
}

/** Nothing here yet: one centred line in brush and a sentence under it. */
export function Empty({ title, text, className }: { title: string; text?: string; className?: string }) {
  return (
    <div className={cx(styles.empty, className)}>
      <strong>{title}</strong>
      {text && <span>{text}</span>}
    </div>
  );
}

/** What a panel of the cultivation life only (洞府, 阵法, 宗门) says under its 「没有…」 in a save of the novel. */
export const NOVEL_SAVE = '这个存档玩的是小说。';

/** The whole page while a screen loads its data. */
export function LoadingScreen({ text = '载入中……' }: { text?: string }) {
  return (
    <div className={styles.screen}>
      <Loading text={text} />
    </div>
  );
}
