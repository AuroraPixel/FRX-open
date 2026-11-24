// 修炼、调息、静候 (gameplay plan item 13; design 四): the panel a standing command of the cultivation life
// opens. How long, and for 修炼 whether to hold spirit stones; under it what doing it now would bring,
// asked of the server on every change (POST …/preview); 「开始」 sends the command as a turn of its own.
// 调息 and 静候 are the same panel with fewer choices: 调息 in double hours, 静候 without the stones and
// without 修满为止. On phones the choices, the preview and 「开始」 share one bottom sheet, as tall as they
// need, with no text to type (no keyboard comes up).
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ApiError, play } from '../../api/client';
import type { PlayDate, StateView, Verb, VerbPreview } from '../../contracts';
import { chineseNumber } from '../../lib/numerals';
import { useStateStore } from '../../store/state';
import { useTurnsStore } from '../../store/turns';
import { useUiStore } from '../../store/ui';
import { Act } from '../../ui/Act';
import { oddsWords } from '../../ui/Acts';
import { Btn } from '../../ui/Btn';
import { KV, type KVItem } from '../../ui/KV';
import { Loading } from '../../ui/Loading';
import { Sub } from '../../ui/Sub';
import { sendCommand } from '../play/commands';
import { MONTHS, lunarDay } from './gameTime';
import { Choice, Row, Slider } from './SettingsControls';
import styles from './Cultivate.module.css';

/** The standing commands this panel serves, by the kind a turn sends. */
export type DaysVerb = 'cultivate' | 'rest' | 'wait';
export const DAYS_VERBS: readonly DaysVerb[] = ['cultivate', 'rest', 'wait'];

const NAME: Record<DaysVerb, string> = { cultivate: '修炼', rest: '调息', wait: '静候' };
const GLYPH: Record<DaysVerb, string> = { cultivate: '修', rest: '息', wait: '候' };
/** what the day it ends is called (a journey's too: the 去处 panel shows its preview the same way) */
const ENDS: Record<string, string> = { cultivate: '出关', rest: '收功', wait: '到', travel: '到', refine: '收功', repair: '修好' };

/** The day it ends, said: 正月十三出关, 正月初四收功, 到正月十三. */
export function endWords(kind: DaysVerb, day: string): string {
  return kind === 'wait' ? `到${day}` : `${day}${ENDS[kind]}`;
}

/** How long a change waits before it is asked about: a slider dragged asks once it rests. */
const SETTLE_MS = 150;

interface Length {
  id: string;
  label: string;
  days?: number;
  hours?: number;
  full?: boolean;
  until?: boolean;
}

// a month is 30 days and a year 360 in the game's calendar (content/cultivation.json)
const DAYS: Length[] = [
  { id: 'd1', label: '一日', days: 1 },
  { id: 'd10', label: '十日', days: 10 },
  { id: 'd30', label: '一月', days: 30 },
  { id: 'd90', label: '三月', days: 90 },
  { id: 'd360', label: '一年', days: 360 },
];
const UNTIL: Length = { id: 'until', label: '到某一天', until: true };

export const LENGTHS: Record<DaysVerb, Length[]> = {
  cultivate: [...DAYS, { id: 'full', label: '修满为止', full: true }, UNTIL],
  // 调息 takes 1 to 12 hours; a double hour is two
  rest: [
    { id: 'h2', label: '一个时辰', hours: 2 },
    { id: 'h4', label: '两个时辰', hours: 4 },
    { id: 'h6', label: '三个时辰', hours: 6 },
    { id: 'h12', label: '半日', hours: 12 },
  ],
  wait: [...DAYS, UNTIL],
};

const DAYS_A_YEAR = 360;
const DAYS_A_MONTH = 30;
/** how far 到某一天 reaches: two years */
const FARTHEST = 720;

type Day = Pick<PlayDate, 'year' | 'month' | 'day'>;

/** Days from 0001-01-01. */
export function dayOf(date: Day): number {
  return (date.year - 1) * DAYS_A_YEAR + (date.month - 1) * DAYS_A_MONTH + (date.day - 1);
}

export function dateOfDay(day: number): Day {
  const within = ((day % DAYS_A_YEAR) + DAYS_A_YEAR) % DAYS_A_YEAR;
  return { year: Math.floor(day / DAYS_A_YEAR) + 1, month: Math.floor(within / DAYS_A_MONTH) + 1, day: (within % DAYS_A_MONTH) + 1 };
}

/** 「0001-03-03」, as Verb.until is written. */
export function untilKey(date: Day): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(date.year).padStart(4, '0')}-${pad(date.month)}-${pad(date.day)}`;
}

/** 「三月初三」; in another year than `today`, 「2年三月初三」. */
export function dateWords(date: Day, today?: Day): string {
  const words = `${MONTHS[date.month - 1] ?? ''}${lunarDay(date.day)}`;
  return today && date.year !== today.year ? `${date.year}年${words}` : words;
}

/** Today in the game: the play view's day, else the time row's (「0001年 01月 03日 23:40」). */
export function todayOf(view: StateView | null): Day | null {
  if (!view) return null;
  if (view.play?.date) return view.play.date;
  const match = /^\s*(\d{1,4})年\s*(\d{1,2})月\s*(\d{1,2})日/.exec(view.time.text);
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null;
}

const two = (n: number) => (n === 2 ? '两' : chineseNumber(n));

/** How long a stretch is, as the annals say it: 两个时辰, 半日, 十日, 三个月, 一年又十日. */
export function spanWords(minutes: number): string {
  if (minutes < 24 * 60) {
    const doubleHours = Math.round(minutes / 120);
    if (doubleHours <= 0) return '片刻';
    return doubleHours === 6 ? '半日' : `${two(doubleHours)}个时辰`;
  }
  const days = Math.round(minutes / (24 * 60));
  if (days < 60) return `${two(days)}日`;
  const years = Math.floor(days / DAYS_A_YEAR);
  const months = Math.floor((days % DAYS_A_YEAR) / DAYS_A_MONTH);
  const rest = days % DAYS_A_MONTH;
  const parts = [years ? `${two(years)}年` : '', months ? `${two(months)}个月` : '', rest ? `${chineseNumber(rest)}日` : ''].filter(Boolean);
  return parts.length > 1 ? `${parts.slice(0, -1).join('')}又${parts[parts.length - 1]}` : (parts[0] ?? '');
}

/** The chance of being come upon, in tenths: 无, 不足一成, 两成. */
export function riskWords(risk: number): string {
  if (risk <= 0) return '无';
  return risk < 5 ? '不足一成' : oddsWords(risk);
}

const shown = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** The verb a turn sends for these choices; `until` is the day 到某一天 stops on (「0001-03-03」). */
export function verbFor(kind: DaysVerb, length: Length, stones: boolean, until: string | null): Verb {
  return {
    kind,
    ...(length.days ? { days: length.days } : {}),
    ...(length.hours ? { hours: length.hours } : {}),
    ...(length.full ? { full: true } : {}),
    ...(length.until && until ? { until } : {}),
    ...(kind === 'cultivate' && stones ? { stones: true } : {}),
  };
}

function facts(preview: VerbPreview, kind: string): KVItem[] {
  const items: KVItem[] = [{ label: '时长', value: spanWords(preview.minutes) }];
  if (preview.ends) items.push({ label: ENDS[kind] ?? '到', value: preview.ends.text });
  if (preview.progress) items.push({ label: '修为', value: `${shown(preview.progress.before)} → ${shown(preview.progress.after)}` });
  if (preview.realm) items.push({ label: '境界', value: `${preview.realm.before} → ${preview.realm.after}` });
  if (preview.stones !== undefined) {
    items.push({
      label: '灵石',
      value: (
        <>
          耗 {preview.stones} 块{preview.shortfall ? <span className={styles.short}>　缺 {preview.shortfall}</span> : null}
        </>
      ),
    });
  }
  if (preview.risk !== undefined) items.push({ label: '被打扰', value: riskWords(preview.risk) });
  return items;
}

/** What doing it now would bring, as the server worked it out. */
export function Preview({ preview, kind }: { preview: VerbPreview; kind: string }) {
  return (
    <>
      {!preview.ok && preview.reason && <p className={styles.reason}>{preview.reason}</p>}
      {preview.lines.length > 0 && (
        <div className={styles.lines}>
          {preview.lines.map((line, at) => (
            <p key={at}>{line}</p>
          ))}
        </div>
      )}
      {preview.ok && <KV items={facts(preview, kind)} className={styles.facts} />}
      {preview.formula.length > 0 && (
        <p className={styles.formula}>
          <b>算式</b>
          {preview.formula.map((term, at) => (
            <span key={at}>
              {term.label} <em>{term.value}</em>
            </span>
          ))}
        </p>
      )}
    </>
  );
}

export function DaysPanel({ saveId, kind }: { saveId: string; kind: DaysVerb }) {
  const view = useStateStore((s) => s.view);
  const closeSheet = useUiStore((s) => s.closeSheet);
  const busy = useTurnsStore((s) => s.live?.status === 'streaming' || s.live?.status === 'pending');
  const lengths = LENGTHS[kind];
  const [lengthId, setLengthId] = useState(lengths[0]!.id);
  const [stones, setStones] = useState(false);
  const today = useMemo(() => todayOf(view), [view]);
  const marks = useMemo(() => (view?.play?.calendar ?? []).filter((mark) => mark.days >= 1 && mark.days <= FARTHEST), [view]);
  const [ahead, setAhead] = useState(() => marks[0]?.days ?? DAYS_A_MONTH);
  const length = lengths.find((item) => item.id === lengthId) ?? lengths[0]!;
  const until = today ? dateOfDay(dayOf(today) + ahead) : null;
  const untilAt = until ? untilKey(until) : null;
  const verb = useMemo(() => verbFor(kind, length, stones, untilAt), [kind, length, stones, untilAt]);
  const asked = JSON.stringify(verb);

  const [preview, setPreview] = useState<VerbPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState(true);
  // asked again on every change, once the change rests; an answer to an older choice is dropped
  const first = useRef(true);
  useEffect(() => {
    const stop = new AbortController();
    const ask = () =>
      play.preview(saveId, JSON.parse(asked) as Verb, stop.signal).then(
        (answer) => {
          if (stop.signal.aborted) return;
          setPreview(answer);
          setProblem(null);
          setAsking(false);
        },
        (error: unknown) => {
          if (stop.signal.aborted) return;
          setPreview(null);
          setProblem(error instanceof ApiError ? error.message : '没能推算出来，稍后再试。');
          setAsking(false);
        },
      );
    setAsking(true);
    const timer = setTimeout(() => void ask(), first.current ? 0 : SETTLE_MS);
    first.current = false;
    return () => {
      clearTimeout(timer);
      stop.abort();
    };
  }, [saveId, asked]);

  const lengthsId = useId();
  const name = NAME[kind];
  const inScene = Boolean(view?.play?.scene);
  const ready = Boolean(preview?.ok) && !asking && !busy && !inScene && !problem;
  const why = busy
    ? `这一回合写完之后才能${name}。`
    : inScene
      ? '这场戏还没收场。'
      : asking
        ? '推算中……'
        : problem
          ? problem
          : preview && !preview.ok
            ? (preview.reason ?? `眼下不能${name}。`)
            : preview
              ? [spanWords(preview.minutes), preview.ends ? endWords(kind, preview.ends.text) : ''].filter(Boolean).join(' · ')
              : '';

  const start = () => {
    if (!ready) return;
    if (sendCommand({ verb })) closeSheet();
  };

  return (
    <div className={styles.panel} data-kind={kind}>
      <section className={styles.part} aria-labelledby={lengthsId}>
        <Sub id={lengthsId}>{kind === 'rest' ? '调息多久' : kind === 'wait' ? '静候多久' : '闭关多久'}</Sub>
        <div className={styles.lengths} role="group" aria-labelledby={lengthsId}>
          {lengths.map((item) => (
            <Btn
              key={item.id}
              variant={item.id === length.id ? 'solid' : 'line'}
              aria-pressed={item.id === length.id}
              onClick={() => setLengthId(item.id)}
            >
              {item.label}
            </Btn>
          ))}
        </div>
        {length.until && today && until && (
          <div className={styles.until}>
            {marks.length > 0 && (
              <div className={styles.marks} role="group" aria-label="日历上的日子">
                {marks.map((mark) => (
                  <Btn
                    key={`${mark.date}${mark.title}`}
                    variant={ahead === mark.days ? 'solid' : 'line'}
                    aria-pressed={ahead === mark.days}
                    onClick={() => setAhead(mark.days)}
                  >
                    {mark.date} · {mark.title}
                  </Btn>
                ))}
              </div>
            )}
            <Row label="到" value={`${dateWords(until, today)} · ${chineseNumber(ahead)}日后`} wide>
              <Slider
                label="到哪一天"
                value={ahead}
                min={1}
                max={FARTHEST}
                onChange={setAhead}
                valueText={`${dateWords(until, today)}，${ahead}日后`}
              />
            </Row>
          </div>
        )}
      </section>
      {kind === 'cultivate' && view && (
        <Row label="用灵石" value={`持有 ${view.player.stones} 块`}>
          <Choice
            label="用灵石"
            options={[
              { id: 'on', label: '用' },
              { id: 'off', label: '不用' },
            ]}
            value={stones ? 'on' : 'off'}
            onChange={(value) => setStones(value === 'on')}
          />
        </Row>
      )}
      <section className={styles.preview} aria-label="预览" aria-busy={asking} data-stale={asking && preview ? '' : undefined}>
        {preview ? <Preview preview={preview} kind={kind} /> : asking ? <Loading text="推算中……" /> : null}
        {problem && (
          <p className={styles.reason} role="alert">
            {problem}
          </p>
        )}
      </section>
      <div className={styles.go}>
        <Act glyph={GLYPH[kind]} name="开始" note={why} hot={ready} unavailable={!ready} onClick={start} />
      </div>
    </div>
  );
}

export function CultivateSheet({ saveId }: { saveId: string }) {
  return <DaysPanel saveId={saveId} kind="cultivate" />;
}

export function RestSheet({ saveId }: { saveId: string }) {
  return <DaysPanel saveId={saveId} kind="rest" />;
}

export function WaitSheet({ saveId }: { saveId: string }) {
  return <DaysPanel saveId={saveId} kind="wait" />;
}
