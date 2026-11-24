// 日历 (gameplay plan item 18): the next years of the calendar (GET …/calendar), a group a year, a row an
// entry: the day, what, where and how many days off. A small seal says whose it is: 固 the region's fixed
// events, 局 what the plot's director scheduled, 己 what the engine keeps for the player (a gate's
// cooldown). The list scrolls inside its sheet; the page does not.
import { useEffect, useId, useState } from 'react';
import { ApiError, play } from '../../api/client';
import type { CalendarEntry } from '../../contracts';
import { chineseNumber } from '../../lib/numerals';
import { useStateStore } from '../../store/state';
import { Empty, Loading } from '../../ui/Loading';
import { Sub } from '../../ui/Sub';
import { dateOfDay, dayOf, todayOf } from './Cultivate';
import styles from './Calendar.module.css';

type Kind = NonNullable<CalendarEntry['kind']>;

export const KIND_SEAL: Record<Kind, string> = { fixed: '固', director: '局', own: '己' };
const KIND_SAID: Record<Kind, string> = { fixed: '这一带固定的事', director: '剧情里排下的事', own: '自己的事' };

/** 今日, 明日, 六十日后. */
export function daysWords(days: number): string {
  if (days <= 0) return '今日';
  if (days === 1) return '明日';
  return `${days === 2 ? '两' : chineseNumber(days)}日后`;
}

/** The year a group stands for: 今年, 明年, 后年, else the year's number. */
export function yearWords(year: number, now: number): string {
  return year === now ? '今年' : year === now + 1 ? '明年' : year === now + 2 ? '后年' : `${year}年`;
}

/** The entries by the year they fall in, counted from today. */
export function byYear(entries: readonly CalendarEntry[], today: { year: number; month: number; day: number } | null) {
  const groups: { year: number; entries: CalendarEntry[] }[] = [];
  for (const entry of entries) {
    const year = today ? dateOfDay(dayOf(today) + entry.days).year : 0;
    const last = groups[groups.length - 1];
    if (last && last.year === year) last.entries.push(entry);
    else groups.push({ year, entries: [entry] });
  }
  return groups;
}

function Group({ year, now, entries }: { year: number; now: number; entries: CalendarEntry[] }) {
  const id = useId();
  return (
    <section className={styles.group} aria-labelledby={id}>
      <Sub id={id}>{now ? yearWords(year, now) : '往后'}</Sub>
      <ol className={styles.list}>
        {entries.map((entry, at) => {
          const kind: Kind = entry.kind ?? 'fixed';
          return (
            <li key={`${entry.days}-${entry.title}-${at}`} className={styles.entry} data-kind={kind}>
              <i className={styles.seal} aria-hidden="true">
                {KIND_SEAL[kind]}
              </i>
              <span className="visually-hidden">{KIND_SAID[kind]}：</span>
              <span className={styles.when}>
                <time>{entry.date}</time>
                <small>{daysWords(entry.days)}</small>
              </span>
              <span className={styles.what}>
                <b>{entry.title}</b>
                {entry.place && <small>{entry.place}</small>}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function CalendarSheet({ saveId }: { saveId: string }) {
  const view = useStateStore((s) => s.view);
  const [entries, setEntries] = useState<CalendarEntry[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const stop = new AbortController();
    play.calendar(saveId, stop.signal).then(
      (answer) => {
        if (!stop.signal.aborted) setEntries(answer.entries);
      },
      (error: unknown) => {
        if (!stop.signal.aborted) setProblem(error instanceof ApiError ? error.message : '日历没能取来，稍后再试。');
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
  if (!entries) return <Loading text="翻检中……" />;
  if (entries.length === 0) return <Empty title="日历上没有事" text="往后三年里没有记下的事。" />;
  const today = todayOf(view);
  return (
    <div className={styles.calendar}>
      {byYear(entries, today).map((group) => (
        <Group key={group.year} year={group.year} now={today?.year ?? 0} entries={group.entries} />
      ))}
    </div>
  );
}
