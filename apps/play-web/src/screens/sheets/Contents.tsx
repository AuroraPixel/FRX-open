// 目录 (章回, gameplay plan item 38): the book's volumes and their 回 (GET …/book), opened from the
// volume at the book's head. A closed volume says what closed it, the days it spans and the words of its
// closing page; the one under way comes last. Each 回 has its 回目 (its scene's name while the scene is
// on). A volume or a 回 pressed closes the panel and the book brings that turn up, fetching the earlier
// pages it needs. The list scrolls inside its sheet.
import { useEffect, useId, useState } from 'react';
import { ApiError, play } from '../../api/client';
import type { BookChapter, BookView, BookVolume } from '../../contracts';
import { chapterWords, coupletLines, spanWords, volumeWords } from '../../lib/book';
import { useUiStore } from '../../store/ui';
import { Loading } from '../../ui/Loading';
import { volumeLead } from '../play/BookPages';
import { useJumpStore } from '../play/jump';
import styles from './Contents.module.css';

function Chapter({ chapter, now, onGo }: { chapter: BookChapter; now: boolean; onGo: (turn: number) => void }) {
  const lines = chapter.couplet ? coupletLines(chapter.couplet) : [];
  const said = lines.length > 0 ? lines.join('，') : (chapter.title ?? '');
  return (
    <li>
      <button
        type="button"
        onClick={() => onGo(chapter.turn)}
        aria-current={now ? 'true' : undefined}
        aria-label={`${chapterWords(chapter.no)}${said ? `：${said}` : ''}${chapter.couplet ? '' : '（未完）'}`}
      >
        <b>{chapterWords(chapter.no)}</b>
        {/* the 回目's two lines each kept whole: where both do not fit, one goes under the other */}
        <span className={styles.name}>
          {lines.length > 0 ? lines.map((line, at) => <span key={at}>{line}</span>) : <span>{chapter.title ?? ''}</span>}
          {!chapter.couplet && <small>未完</small>}
        </span>
      </button>
    </li>
  );
}

function Volume({ volume, book, onGo }: { volume: BookVolume; book: BookView; onGo: (turn: number) => void }) {
  const id = useId();
  const going = volume.no === book.volume;
  const name = volume.name ?? (going ? '此卷未完' : '');
  const about = going ? spanWords(volume.since) : [volumeLead(volume), spanWords(volume.since, volume.until)].filter(Boolean).join(' · ');
  const title = (
    <>
      <b>{volumeWords(volume.no)}</b>
      {name && <span>{name}</span>}
    </>
  );
  return (
    <section className={styles.volume} aria-labelledby={id} data-going={going ? '' : undefined}>
      <h3 id={id} className={styles.head}>
        {volume.turn !== undefined ? (
          <button type="button" onClick={() => volume.turn !== undefined && onGo(volume.turn)}>
            {title}
          </button>
        ) : (
          <span>{title}</span>
        )}
      </h3>
      {about && <p className={styles.about}>{about}</p>}
      {volume.text && <p className={styles.words}>{volume.text}</p>}
      {volume.chapters.length > 0 ? (
        <ol className={styles.chapters} aria-label={`${volumeWords(volume.no)}的回`}>
          {volume.chapters.map((chapter) => (
            <Chapter key={chapter.no} chapter={chapter} now={going && chapter.no === book.chapter} onGo={onGo} />
          ))}
        </ol>
      ) : (
        <p className={styles.none}>{going ? '这一卷还没有成回的戏。' : '这一卷没有成回的戏。'}</p>
      )}
    </section>
  );
}

export function ContentsSheet({ saveId }: { saveId: string }) {
  const [book, setBook] = useState<BookView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const stop = new AbortController();
    play.book(saveId, stop.signal).then(
      (answer) => {
        if (!stop.signal.aborted) setBook(answer);
      },
      (error: unknown) => {
        if (!stop.signal.aborted) setProblem(error instanceof ApiError ? error.message : '目录没能取来，稍后再试。');
      },
    );
    return () => stop.abort();
  }, [saveId]);

  if (problem) {
    return (
      <p className={styles.problem} role="alert">
        {problem}
      </p>
    );
  }
  if (!book) return <Loading text="翻检中……" />;
  const go = (turn: number) => {
    useJumpStore.getState().jump(turn);
    useUiStore.getState().closeSheet();
  };
  return <ContentsList book={book} onGo={go} />;
}

/** The volumes and their 回 as the panel lists them; `onGo` takes the turn a volume or a 回 starts in. */
export function ContentsList({ book, onGo }: { book: BookView; onGo: (turn: number) => void }) {
  return (
    <div className={styles.contents}>
      {book.volumes.map((volume) => (
        <Volume key={volume.no} volume={volume} book={book} onGo={onGo} />
      ))}
    </div>
  );
}
