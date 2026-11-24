// 差事 (gameplay plan item 35): the notices up at the player's place this half-year (GET …/notices). A row
// each notice: its kind's seal (猎 采 护 寻 矿), the title, where, how long and what it pays, 「已揭」 on one
// taken. A row pressed shows the notice whole with the preview of taking it (POST …/preview, verb job
// with its id), 「揭下」 sending that verb and 「看别的」 going back. A place with no board says so.
import { useEffect, useId, useState } from 'react';
import { ApiError, play } from '../../api/client';
import type { Notice, NoticeBoard } from '../../contracts';
import { chineseNumber } from '../../lib/numerals';
import { useStateStore } from '../../store/state';
import { useTurnsStore } from '../../store/turns';
import { useUiStore } from '../../store/ui';
import { Act } from '../../ui/Act';
import { Btn } from '../../ui/Btn';
import { Empty, Loading } from '../../ui/Loading';
import { sendCommand } from '../play/commands';
import { Preview, spanWords } from './Cultivate';
import days from './Cultivate.module.css';
import { usePreview } from './usePreview';
import styles from './Notices.module.css';

/** 「松灯林 · 二十一日之内 · 酬十块灵石」 */
export function noticeTerms(notice: Notice): string {
  return [notice.place, `${chineseNumber(notice.days)}日之内`, notice.pay ? `酬${chineseNumber(notice.pay)}块灵石` : '没有酬劳'].join(' · ');
}

/** The seal of a notice's kind: its first character (猎妖 → 猎). */
export const noticeSeal = (notice: Notice): string => notice.kind.slice(0, 1) || '告';

function NoticeDetail({ saveId, notice, onBack }: { saveId: string; notice: Notice; onBack: () => void }) {
  const view = useStateStore((s) => s.view);
  const closeSheet = useUiStore((s) => s.closeSheet);
  const busy = useTurnsStore((s) => s.live?.status === 'streaming' || s.live?.status === 'pending');
  const { preview, problem, asking } = usePreview(saveId, notice.taken ? null : { kind: 'job', id: notice.id });
  const inScene = Boolean(view?.play?.scene || view?.play?.fight);
  const ready = !notice.taken && Boolean(preview?.ok) && !asking && !busy && !inScene;
  const why = notice.taken
    ? '这张已经揭下了'
    : busy
      ? '这一回合写完之后才能揭。'
      : inScene
        ? '这场戏还没收场。'
        : asking
          ? '推算中……'
          : (problem ?? (preview && !preview.ok ? (preview.reason ?? '眼下揭不了。') : preview ? `${spanWords(preview.minutes)} · ${notice.days}日内办成` : ''));
  const take = () => {
    if (ready && sendCommand({ verb: { kind: 'job', id: notice.id } })) closeSheet();
  };
  const titleId = useId();
  return (
    <section className={styles.detail} aria-labelledby={titleId}>
      <header className={styles.head}>
        <i className={styles.seal} aria-hidden="true">
          {noticeSeal(notice)}
        </i>
        <h3 id={titleId}>{notice.title}</h3>
      </header>
      <p className={styles.text}>{notice.text}</p>
      <p className={styles.terms}>{noticeTerms(notice)}</p>
      {!notice.taken && (
        <div className={days.preview} aria-label="预览" aria-busy={asking}>
          {preview ? <Preview preview={preview} kind="job" /> : !problem ? <Loading text="推算中……" /> : null}
          {problem && (
            <p className={days.reason} role="alert">
              {problem}
            </p>
          )}
        </div>
      )}
      <div className={styles.go}>
        <Act glyph="告" name="揭下" note={why} hot={ready} unavailable={!ready} onClick={take} />
        <Btn onClick={onBack}>看别的</Btn>
      </div>
    </section>
  );
}

export function NoticesSheet({ saveId }: { saveId: string }) {
  const [board, setBoard] = useState<NoticeBoard | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    const stop = new AbortController();
    play.notices(saveId, stop.signal).then(
      (answer) => !stop.signal.aborted && setBoard(answer),
      (error: unknown) => !stop.signal.aborted && setProblem(error instanceof ApiError ? error.message : '告示没能取来，稍后再试。'),
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
  if (!board) return <Loading text="看告示……" />;
  if (!board.open) return <Empty title="这里没有告示" text="有告示或执事堂的地方才贴差事。" />;
  const notice = board.notices.find((each) => each.id === picked);
  if (notice) return <NoticeDetail key={notice.id} saveId={saveId} notice={notice} onBack={() => setPicked(null)} />;
  return (
    <div className={styles.board}>
      <p className={styles.where}>
        <b>{board.place ?? '此处'}</b>
        {board.until ? `告示到${board.until.text}换一批` : '告示半年换一批'}
      </p>
      {board.notices.length === 0 ? (
        <p className={styles.none}>这半年没有差事。</p>
      ) : (
        <ul className={styles.rows} aria-label="告示">
          {board.notices.map((each) => (
            <li key={each.id}>
              <button type="button" className={styles.row} data-taken={each.taken ? '' : undefined} onClick={() => setPicked(each.id)}>
                <i className={styles.seal} aria-hidden="true">
                  {noticeSeal(each)}
                </i>
                <span className={styles.what}>
                  <b>{each.title}</b>
                  <small>{noticeTerms(each)}</small>
                </span>
                {each.taken && <em className={styles.taken}>已揭</em>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
