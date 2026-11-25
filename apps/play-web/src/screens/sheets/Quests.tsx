// 任务 (plan item 43; spec 七, 任务): the mainline on a large card with its clues, then the quests
// under two tabs, in progress and finished. A picked quest opens to its reward and penalty. Under
// them, 剧情演化: the player's own guidance, a run now and the save's main plot switch (Director).
// The cultivation life has the story instead of the card (Story.tsx): the storyline's name and hook,
// 这一章, 疑点, 因果 and 心结.
import { useId, useState } from 'react';
import type { Mainline, Quest } from '../../contracts';
import { useStateStore } from '../../store/state';
import { useTurnsStore } from '../../store/turns';
import { followLead } from '../play/commands';
import { Entry } from '../../ui/Entry';
import { Empty, Loading } from '../../ui/Loading';
import { Tabs } from '../../ui/Tabs';
import { useAim } from './aim';
import { Director } from './Director';
import { More } from './More';
import { QUEST_GLYPH, QUEST_STATE_NAME } from './labels';
import { Rows } from './Rows';
import { Karma, Knots, Leads, StoryHead } from './Story';
import common from './common.module.css';
import styles from './Quests.module.css';

type Tab = 'active' | 'closed';

const TABS: { id: Tab; label: string }[] = [
  { id: 'active', label: '进行中' },
  { id: 'closed', label: '已完成' },
];

function MainlineCard({ line }: { line: Mainline }) {
  const done = line.clues.filter((clue) => clue.done).length;
  return (
    <section className={styles.main} aria-label="主线">
      <span className={styles.kicker}>主线</span>
      <strong className={styles.chapter}>{line.chapter}</strong>
      <p className={styles.goal}>{line.goal}</p>
      {line.clues.length > 0 && (
        <ul className={styles.clues} aria-label={`线索，已成 ${done} 条，共 ${line.clues.length} 条`}>
          {line.clues.map((clue, index) => (
            <li key={`${clue.text}-${index}`} data-done={clue.done ? '' : undefined}>
              <i aria-hidden="true" />
              <span>{clue.text}</span>
              <span className="visually-hidden">{clue.done ? '，已成' : '，未成'}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function QuestMore({ id, quest }: { id: string; quest: Quest }) {
  return (
    <More id={id}>
      <p>{quest.text}</p>
      <Rows
        rows={[
          quest.note ? { label: '进度', value: quest.note } : null,
          quest.reward ? { label: '奖励', value: quest.reward } : null,
          quest.penalty ? { label: '惩罚', value: quest.penalty } : null,
          { label: '状态', value: QUEST_STATE_NAME[quest.status] },
        ]}
      />
    </More>
  );
}

export function Quests({ saveId }: { saveId: string }) {
  const view = useStateStore((s) => s.view);
  const busy = useTurnsStore((s) => s.conflict || s.live?.status === 'streaming' || s.live?.status === 'pending');
  const aim = useAim('quests');
  const aimed = view?.quests.find((quest) => quest.id === aim?.pick);
  const [tab, setTab] = useState<Tab>(
    aimed ? (aimed.status === 'active' ? 'active' : 'closed') : aim?.tab === 'closed' ? 'closed' : 'active',
  );
  const [open, setOpen] = useState<string | null>(aimed?.id ?? null);
  const paneId = useId();
  const moreId = useId();

  if (!view) return <Loading text="载入中……" />;
  const shown = view.quests.filter((quest) =>
    tab === 'active' ? quest.status === 'active' : quest.status !== 'active',
  );

  return (
    <>
      {view.play ? (
        <>
          {view.mainline && <StoryHead line={view.mainline} date={view.play.date} />}
          <Leads leads={view.play.leads ?? []} disabled={busy} onFollow={followLead} />
          <Karma karma={view.play.karma ?? []} />
          <Knots knots={view.play.knots ?? []} />
        </>
      ) : (
        view.mainline && <MainlineCard line={view.mainline} />
      )}
      <div className={common.tabsRow}>
        <Tabs
          label="任务分类"
          items={TABS}
          value={tab}
          controls={paneId}
          onChange={(id) => setTab(id === 'closed' ? 'closed' : 'active')}
        />
      </div>
      <div id={paneId} className={common.pane} role="tabpanel" aria-label={tab === 'active' ? '进行中' : '已完成'}>
        {shown.length === 0 ? (
          tab === 'active' ? (
            <Empty title="尚无任务" text="接下的任务会列在这里。" />
          ) : (
            <Empty title="尚无了结" text="完成或失败的任务会收在这里。" />
          )
        ) : (
          <ul className={common.list}>
            {shown.map((quest) => {
              const expanded = open === quest.id;
              return (
                <li key={quest.id}>
                  <Entry
                    className={common.tall}
                    title={quest.title}
                    text={
                      expanded ? undefined : (
                        <>
                          <span className={common.oneLine}>{quest.text}</span>
                          {quest.note && <span className={styles.progress}>{quest.note}</span>}
                        </>
                      )
                    }
                    status={QUEST_GLYPH[quest.status]}
                    state={quest.status === 'active' ? 'active' : quest.status === 'done' ? 'done' : 'plain'}
                    selected={expanded}
                    onClick={() => setOpen(expanded ? null : quest.id)}
                  />
                  {expanded && <QuestMore id={`${moreId}-${quest.id}`} quest={quest} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <Director saveId={saveId} />
    </>
  );
}
