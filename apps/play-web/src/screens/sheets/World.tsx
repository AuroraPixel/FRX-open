// 世界与见闻 (plan item 46; spec 七, 世界与见闻): the daily paper issue by issue, whose offered deeds
// become chips in the action queue; the world's great events, newest first; and the biographies.
// The paper and the events come from GET …/news and …/events when the panel opens. The daily paper
// and the biographies are off until the player turns them on (the old page's defaults): an empty
// 见闻 or 档案 then says so and where to turn it on, from GET /settings.
import { type ReactNode, useCallback, useEffect, useId, useState } from 'react';
import { ApiError, play } from '../../api/client';
import type { EventsView, NewsAction, NewsIssue, NewsView, PlaySettings, QueueItem } from '../../contracts';
import { chapterTitle, chineseNumber } from '../../lib/numerals';
import { useQueueStore } from '../../store/queue';
import { useStateStore } from '../../store/state';
import { Btn } from '../../ui/Btn';
import { Entry } from '../../ui/Entry';
import { Empty, Loading } from '../../ui/Loading';
import { Tabs } from '../../ui/Tabs';
import { queueChip } from './act';
import { useAim } from './aim';
import { More } from './More';
import { sayGameTime } from './gameTime';
import common from './common.module.css';
import styles from './World.module.css';

type Tab = 'news' | 'events' | 'archive';

/** Whether a switch of GET /settings an empty tab speaks of is off: null while the settings are on
 * their way; false when they cannot be read. */
function off(settings: Fetched<PlaySettings>, name: 'paper' | 'biographies'): boolean | null {
  if (settings.error) return false;
  if (!settings.data) return null;
  return settings.data[name]?.enabled === false;
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'news', label: '见闻' },
  { id: 'events', label: '大事' },
  { id: 'archive', label: '档案' },
];

function isTab(value: string | undefined): value is Tab {
  return TABS.some((tab) => tab.id === value);
}

interface Fetched<T> {
  data: T | null;
  error: ApiError | null;
  retry: () => void;
}

/** One of the play interface's read-only views, fetched when the panel opens. */
function useFetched<T>(load: () => Promise<T>): Fetched<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    load().then(
      (answer) => live && setData(answer),
      (problem: unknown) => live && setError(problem instanceof ApiError ? problem : new ApiError('network')),
    );
    return () => {
      live = false;
    };
  }, [load, round]);
  return { data, error, retry: useCallback(() => setRound((n) => n + 1), []) };
}

function Waiting<T>({ fetched, children }: { fetched: Fetched<T>; children: (data: T) => ReactNode }) {
  if (fetched.data) return <>{children(fetched.data)}</>;
  if (fetched.error) {
    return (
      <div className={styles.failed} role="alert">
        <p>{fetched.error.message}</p>
        <Btn onClick={fetched.retry}>重试</Btn>
      </div>
    );
  }
  return <Loading text="翻检中……" />;
}

function sameChip(a: QueueItem, b: QueueItem): boolean {
  return a.kind === b.kind && a.text === b.text;
}

function Issue({ issue, id }: { issue: NewsIssue; id: string }) {
  const waiting = useQueueStore((s) => s.items);
  const take = (action: NewsAction) => queueChip(action.queue);
  return (
    <More id={id}>
      {issue.paragraphs.map((paragraph, index) => (
        <p key={index} className={styles.paper}>
          {paragraph}
        </p>
      ))}
      {issue.actions.length > 0 && (
        <div className={common.actions} role="group" aria-label="可以去做的事">
          {issue.actions.map((action, index) => {
            const queued = waiting.some((chip) => sameChip(chip, action.queue));
            return (
              <Btn
                key={`${action.text}-${index}`}
                variant={queued ? 'solid' : 'line'}
                aria-pressed={queued}
                onClick={() => take(action)}
              >
                {action.text}
              </Btn>
            );
          })}
        </div>
      )}
    </More>
  );
}

/**
 * The model writes the same title and date for the issues of one game day (实玩二: six 「云汀湾修仙晨报」
 * of 01月17日): the issue's number and the turn it came with tell them apart.
 */
export function issueTitle(issue: NewsIssue): string {
  return `${issue.title} · 第${chineseNumber(issue.no)}期`;
}

export function issueWhen(issue: NewsIssue): string {
  return [issue.date, issue.turn ? chapterTitle(issue.turn) : ''].filter(Boolean).join(' · ');
}

function News({
  news,
  paperOff,
  picked,
  onPick,
}: {
  news: NewsView;
  /** the daily paper is not written: the empty tab says where to turn it on; null: not known yet */
  paperOff: boolean | null;
  picked: string | null;
  onPick: (id: string | null) => void;
}) {
  const moreId = useId();
  if (news.issues.length === 0) {
    if (paperOff === null) return <Loading text="翻检中……" />;
    return paperOff ? (
      <Empty title="尚无见闻" text="日报没有开，在「设置 · 日报」里打开。" />
    ) : (
      <Empty title="尚无见闻" text="日报每隔几日一期，出了就在这里。" />
    );
  }
  return (
    <ul className={common.list}>
      {news.issues.map((issue) => {
        const expanded = picked === issue.id;
        return (
          <li key={issue.id}>
            <Entry
              className={common.tall}
              title={issueTitle(issue)}
              text={
                <>
                  <span className={styles.date}>{issueWhen(issue)}</span>
                  {!expanded && issue.paragraphs[0] && <span className={common.oneLine}>{issue.paragraphs[0]}</span>}
                </>
              }
              selected={expanded}
              onClick={() => onPick(expanded ? null : issue.id)}
            />
            {expanded && <Issue issue={issue} id={`${moreId}-${issue.id}`} />}
          </li>
        );
      })}
    </ul>
  );
}

/** The great events as the server lists them: newest first by the game's time (docs/play-contracts.md, EventsView). */
function Events({ events }: { events: EventsView['events'] }) {
  if (events.length === 0) return <Empty title="尚无大事" text="天下的大事会记在这里。" />;
  return (
    <ol className={styles.events}>
      {events.map((event, index) => (
        <li key={`${event.at}-${index}`}>
          <span className={styles.when}>{sayGameTime(event.at)}</span>
          <p>{event.text}</p>
        </li>
      ))}
    </ol>
  );
}

function Archive({
  biographies,
  writtenOff,
  picked,
  onPick,
}: {
  biographies: EventsView['biographies'];
  /** biographies are not written: the empty tab says where to turn them on; null: not known yet */
  writtenOff: boolean | null;
  picked: string | null;
  onPick: (id: string | null) => void;
}) {
  const moreId = useId();
  if (biographies.length === 0) {
    if (writtenOff === null) return <Loading text="翻检中……" />;
    return writtenOff ? (
      <Empty title="尚无档案" text="人物传记没有开，在「设置 · 记忆」里打开。" />
    ) : (
      <Empty title="尚无档案" text="结识的人物，传记会存在这里。" />
    );
  }
  return (
    <ul className={common.list}>
      {biographies.map((biography, index) => {
        const key = biography.charId ?? biography.title;
        const expanded = picked === key;
        const id = `${moreId}-${index}`;
        return (
          <li key={`${key}-${index}`}>
            <Entry
              className={common.tall}
              title={biography.title}
              selected={expanded}
              onClick={() => onPick(expanded ? null : key)}
            />
            {expanded && (
              <More id={id}>
                {biography.text
                  .split(/\n+/)
                  .filter(Boolean)
                  .map((paragraph, at) => (
                    <p key={at} className={styles.paper}>
                      {paragraph}
                    </p>
                  ))}
              </More>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function World({ saveId }: { saveId: string }) {
  const aim = useAim('world');
  const [tab, setTab] = useState<Tab>(isTab(aim?.tab) ? aim.tab : 'news');
  const [picked, setPicked] = useState<string | null>(aim?.pick ?? null);
  const paneId = useId();
  // read again whenever the save moves on (a turn ends while the panel is open)
  const version = useStateStore((s) => s.view?.version);
  const news = useFetched(useCallback(() => play.news(saveId), [saveId, version]));
  const world = useFetched(useCallback(() => play.world(saveId), [saveId, version]));
  // what the empty tabs say; a failed read leaves them as they are
  const settings = useFetched(useCallback(() => play.settings(), []));
  const label = TABS.find((t) => t.id === tab)?.label ?? '';

  return (
    <>
      <div className={common.tabsRow}>
        <Tabs
          label="世界与见闻"
          items={TABS}
          value={tab}
          controls={paneId}
          onChange={(id) => {
            if (!isTab(id)) return;
            setTab(id);
            setPicked(null);
          }}
        />
      </div>
      <div id={paneId} className={common.pane} role="tabpanel" aria-label={label}>
        {tab === 'news' && (
          <Waiting fetched={news}>
            {(data) => (
              <News news={data} paperOff={off(settings, 'paper')} picked={picked} onPick={setPicked} />
            )}
          </Waiting>
        )}
        {tab === 'events' && <Waiting fetched={world}>{(data) => <Events events={data.events} />}</Waiting>}
        {tab === 'archive' && (
          <Waiting fetched={world}>
            {(data) => (
              <Archive
                biographies={data.biographies}
                writtenOff={off(settings, 'biographies')}
                picked={picked}
                onPick={setPicked}
              />
            )}
          </Waiting>
        )}
      </div>
    </>
  );
}
