// 一生的年谱 (gameplay plan item 49): a whole life from GET …/life, laid out as a page of the book: the
// name in brush with the realm, the age and the end; year by year the lines worth keeping, each year with
// the age in it; every gate passed; the volumes of the book this life saw (item 38: why each closed, its
// closing words and its 回); what was left behind; the old acquaintances' words. 存成图 paints it 1080 px
// wide (lifeImage.ts) and shares or downloads it; 前一世 and 后一世 page through the lives that ended. While
// the heir is still to be chosen, 定下传人 goes back to the choice.
import { useEffect, useState } from 'react';
import { ApiError, play as api } from '../../api/client';
import type { BookVolume, LifeView } from '../../contracts';
import { chineseNumber } from '../../lib/numerals';
import { useStateStore } from '../../store/state';
import { useUiStore } from '../../store/ui';
import { Btn } from '../../ui/Btn';
import { Loading } from '../../ui/Loading';
import { givePicture, inked, paintLife } from './lifeImage';
import { dayWithYear, lifeHead, lifeLeft, yearHead } from './lifeWords';
import styles from './Life.module.css';

/** 「一年正月初一 — 十五年三月初三」, 「九十六年九月初九起」 */
function spanOf(volume: BookVolume): string {
  const at = (date?: { year: number; text: string }) => (date ? `${chineseNumber(date.year)}年${date.text}` : '');
  return volume.until ? `${at(volume.since)} — ${at(volume.until)}` : `${at(volume.since)}起，还在写`;
}

function Volumes({ volumes }: { volumes: BookVolume[] }) {
  if (!volumes.length) return null;
  return (
    <section className={styles.part} aria-label="卷">
      <h4>卷</h4>
      <ol className={styles.volumes}>
        {volumes.map((volume) => (
          <li key={volume.no}>
            <p className={styles.volume}>
              <b>
                第{chineseNumber(volume.no)}卷{volume.name ? `　${volume.name}` : ''}
              </b>
              <small>{spanOf(volume)}</small>
            </p>
            {volume.text && <p className={styles.closing}>{volume.text}</p>}
            {volume.chapters.length > 0 && (
              <ul className={styles.chapters}>
                {volume.chapters.map((chapter) => (
                  <li key={chapter.no}>
                    <i>第{chineseNumber(chapter.no)}回</i>
                    <span>{chapter.couplet ?? chapter.title ?? ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function LifeSheet({ saveId }: { saveId: string }) {
  const choosing = useStateStore((s) => s.view?.play?.legacy?.state === 'choosing');
  const notify = useUiStore((s) => s.notify);
  const openSheet = useUiStore((s) => s.openSheet);
  const [index, setIndex] = useState<number | undefined>(undefined);
  const [life, setLife] = useState<LifeView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [painting, setPainting] = useState(false);
  useEffect(() => {
    const stop = new AbortController();
    setLife(null);
    setProblem(null);
    api.life(saveId, index, stop.signal).then(
      (answer) => !stop.signal.aborted && setLife(answer),
      (error: unknown) => !stop.signal.aborted && setProblem(error instanceof ApiError ? error.message : '年谱没能取来，稍后再试。'),
    );
    return () => stop.abort();
  }, [saveId, index]);

  if (problem) {
    return (
      <p className={styles.problem} role="alert">
        {problem}
      </p>
    );
  }
  if (!life) return <Loading text="翻年谱……" />;
  const at = life.index;
  const save = async () => {
    setPainting(true);
    try {
      const canvas = await paintLife(life);
      if (!canvas) {
        notify('这台设备画不了图。', 'error');
        return;
      }
      // the end-to-end checks read what was painted (sample mode only)
      if ('__frxSent' in window) {
        Object.assign(window, { __frxLifeImage: { width: canvas.width, height: canvas.height, inked: inked(canvas) }, __frxLifeCanvas: canvas });
      }
      const given = await givePicture(canvas, life.name);
      if (given === 'saved') notify(`已存成图：${life.name}的一生.png`);
      else if (given === 'failed') notify('图没能存下来。', 'error');
    } finally {
      setPainting(false);
    }
  };
  const left = lifeLeft(life);
  return (
    <article className={styles.page} aria-label={`${life.name}的一生`}>
      <header className={styles.head}>
        <h3>{life.name}</h3>
        <i aria-hidden="true">一生</i>
        <p>{lifeHead(life)}</p>
      </header>

      {life.years.length > 0 && (
        <section className={styles.part} aria-label="年谱">
          <h4>年谱</h4>
          <ol className={styles.years}>
            {life.years.map((year) => (
              <li key={year.year}>
                <b className={styles.year}>{yearHead(year)}</b>
                <ul>
                  {year.lines.map((line, n) => (
                    <li key={`${line.date}-${n}`} data-kind={line.kind ?? undefined}>
                      <i>{line.date}</i>
                      <span>{line.text}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      )}

      {life.gates.length > 0 && (
        <section className={styles.part} aria-label="过关">
          <h4>过关</h4>
          <ol className={styles.gates}>
            {life.gates.map((gate) => (
              <li key={`${gate.date}-${gate.to}`}>
                <i aria-hidden="true">关</i>
                <span>
                  <b>
                    {gate.name ?? gate.gate} → {gate.to}
                  </b>
                  <small>
                    {[gate.age !== undefined ? `${chineseNumber(gate.age)}岁` : '', dayWithYear(gate.date), gate.foundation ? `根基${gate.foundation}` : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <Volumes volumes={life.volumes} />

      {left.length > 0 && (
        <section className={styles.part} aria-label="留下">
          <h4>留下</h4>
          <dl className={styles.left}>
            {left.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {life.eulogies.length > 0 && (
        <section className={styles.part} aria-label="故人">
          <h4>故人</h4>
          <ul className={styles.eulogies}>
            {life.eulogies.map((said) => (
              <li key={said.id ?? said.name}>
                <q>{said.text}</q>
                <cite>
                  {said.name}
                  {said.kind ? `（${said.kind}）` : ''}
                </cite>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className={styles.foot}>
        <Btn variant="solid" onClick={() => void save()} disabled={painting}>
          {painting ? '正在画……' : '存成图'}
        </Btn>
        {at !== undefined && at > 0 && <Btn onClick={() => setIndex(at - 1)}>前一世</Btn>}
        {at !== undefined && at < life.lives - 1 && <Btn onClick={() => setIndex(at + 1)}>后一世</Btn>}
        {at === undefined && life.lives > 0 && <Btn onClick={() => setIndex(life.lives - 1)}>前一世</Btn>}
        {choosing && <Btn onClick={() => openSheet('legacy')}>定下传人</Btn>}
      </footer>
    </article>
  );
}
