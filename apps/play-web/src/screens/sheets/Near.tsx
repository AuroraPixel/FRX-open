// 去处 (gameplay plan item 28; the design's 十四: 去处，地图加功能标签、路程和日数): in a save of the
// cultivation life the map panel opens on 「近处」, the nearest map places of the region by distance
// (view.play.near), a row each: the name, its kind and the small tags of its venues, the distance and the
// days on foot. A row pressed shows the journey's preview (POST …/preview with { kind: 'travel', to },
// the same answer the turn would settle), and 「启程」 sends verb { kind: 'travel', to }. A place picked on
// the map page comes here the same way.
import { useEffect, useId, useState } from 'react';
import { ApiError, play } from '../../api/client';
import type { PlayNear, PlayPlace, VerbPreview } from '../../contracts';
import { chineseNumber } from '../../lib/numerals';
import { useStateStore } from '../../store/state';
import { useTurnsStore } from '../../store/turns';
import { useUiStore } from '../../store/ui';
import { Act } from '../../ui/Act';
import { Btn } from '../../ui/Btn';
import { Loading } from '../../ui/Loading';
import { Sub } from '../../ui/Sub';
import { sendCommand } from '../play/commands';
import { Preview, spanWords } from './Cultivate';
import { PlaceExtras } from './PlaceExtras';
import days from './Cultivate.module.css';
import styles from './Near.module.css';

const two = (n: number) => (n === 2 ? '两' : chineseNumber(n));

/** 「一日」「两日」「十二日」 */
export function daysOnFoot(n: number): string {
  return `${two(Math.max(1, n))}日`;
}

/** 「路程十八」 */
export function distanceWords(distance: number): string {
  return `路程${chineseNumber(Math.max(0, Math.round(distance)))}`;
}

/** What a screen reader hears for a row. */
export function nearLabel(place: PlayNear): string {
  return `${place.name}，${place.kind}${place.venues.length ? `，有${place.venues.join('、')}` : ''}，${distanceWords(place.distance)}，行${daysOnFoot(place.days)}`;
}

/** 「泊灯城 · 城镇 · 灵气薄 · 太平」: where the player stands. */
export function hereWords(place: PlayPlace): string {
  return [place.name, place.kind, `灵气${place.aura}`, place.danger].filter(Boolean).join(' · ');
}

/** The nearest places, nearest first; a row pressed asks for its journey. */
export function NearList({ near, here, onPick }: { near: PlayNear[]; here?: PlayPlace; onPick: (name: string) => void }) {
  const titleId = useId();
  // the home and the arrays where the player stands (items 45 and 43), under 此处 and over 近处
  const play = useStateStore((s) => s.view?.play);
  const sorted = [...near].sort((a, b) => a.distance - b.distance);
  return (
    <div className={styles.near}>
      {here && (
        <p className={styles.here}>
          <b>此处</b>
          {hereWords(here)}
        </p>
      )}
      {here && play && <PlaceExtras play={play} />}
      <section className={styles.near} aria-labelledby={titleId}>
        <Sub id={titleId}>近处</Sub>
        {sorted.length === 0 ? (
          <p className={styles.none}>这一带没有别处可去。</p>
        ) : (
          <ol className={styles.rows}>
            {sorted.map((place) => (
              <li key={place.name}>
                <button type="button" className={styles.row} aria-label={nearLabel(place)} onClick={() => onPick(place.name)}>
                  <span className={styles.what} aria-hidden="true">
                    <strong>{place.name}</strong>
                    <em>{place.kind}</em>
                    {place.venues.length > 0 && (
                      <span className={styles.venues}>
                        {place.venues.map((venue) => (
                          <i key={venue}>{venue}</i>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className={styles.far} aria-hidden="true">
                    <b>{daysOnFoot(place.days)}</b>
                    <small>{distanceWords(place.distance)}</small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

/** One journey: its preview as the engine works it out, 「启程」, and back to the list. */
export function TravelPanel({ saveId, to, onBack }: { saveId: string; to: string; onBack: () => void }) {
  const view = useStateStore((s) => s.view);
  const closeSheet = useUiStore((s) => s.closeSheet);
  const busy = useTurnsStore((s) => s.live?.status === 'streaming' || s.live?.status === 'pending');
  const [preview, setPreview] = useState<VerbPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const titleId = useId();
  const place = view?.play?.near?.find((each) => each.name === to);

  useEffect(() => {
    const stop = new AbortController();
    setPreview(null);
    setProblem(null);
    play.preview(saveId, { kind: 'travel', to }, stop.signal).then(
      (answer) => !stop.signal.aborted && setPreview(answer),
      (error: unknown) => !stop.signal.aborted && setProblem(error instanceof ApiError ? error.message : '没能推算出来，稍后再试。'),
    );
    return () => stop.abort();
  }, [saveId, to]);

  const inScene = Boolean(view?.play?.scene || view?.play?.fight || view?.play?.realm);
  const ready = Boolean(preview?.ok) && !busy && !inScene;
  const why = busy
    ? '这一回合写完之后才能启程。'
    : inScene
      ? view?.play?.realm
        ? `身在${view.play.realm.name}，出去之后才能赶路。`
        : '这场戏还没收场。'
      : problem
        ? problem
        : !preview
          ? '推算中……'
          : !preview.ok
            ? (preview.reason ?? '眼下去不了。')
            : [spanWords(preview.minutes), preview.ends ? `${preview.ends.text}到` : ''].filter(Boolean).join(' · ');
  const go = () => {
    if (ready && sendCommand({ verb: { kind: 'travel', to } })) closeSheet();
  };

  return (
    <section className={styles.travel} aria-labelledby={titleId}>
      <header className={styles.head}>
        <h3 id={titleId}>
          <span aria-hidden="true">往</span>
          {to}
        </h3>
        {place && (
          <p>
            <em>{place.kind}</em>
            {place.venues.map((venue) => (
              <i key={venue}>{venue}</i>
            ))}
          </p>
        )}
      </header>
      <div className={days.preview} aria-label="预览" aria-busy={!preview && !problem}>
        {preview ? <Preview preview={preview} kind="travel" /> : !problem ? <Loading text="推算中……" /> : null}
        {problem && (
          <p className={days.reason} role="alert">
            {problem}
          </p>
        )}
      </div>
      <div className={styles.go}>
        <Act glyph="往" name="启程" note={why} hot={ready} unavailable={!ready} onClick={go} />
        <Btn onClick={onBack}>换一处</Btn>
      </div>
    </section>
  );
}
