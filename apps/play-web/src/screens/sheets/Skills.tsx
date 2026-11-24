// 技能 (plan item 42; spec 七, 技能): the skills under three tabs, each with its layer in brush at the
// top right and one line of what it does; a picked skill opens to its proficiency, cost and effect.
import { useId, useState } from 'react';
import type { Skill } from '../../contracts';
import { useStateStore } from '../../store/state';
import { Bar } from '../../ui/Bar';
import { Entry } from '../../ui/Entry';
import { KV, type KVItem } from '../../ui/KV';
import { Empty, Loading } from '../../ui/Loading';
import { Tabs } from '../../ui/Tabs';
import { useAim } from './aim';
import { More } from './More';
import { SKILL_TABS } from './labels';
import common from './common.module.css';

type Kind = Skill['kind'];

function isKind(value: string | undefined): value is Kind {
  return SKILL_TABS.some((tab) => tab.id === value);
}

function SkillMore({ id, skill }: { id: string; skill: Skill }) {
  const facts: KVItem[] = [
    ...(skill.grade ? [{ label: '品阶', value: skill.grade }] : []),
    ...(skill.layer ? [{ label: '层数', value: skill.layer }] : []),
    ...(skill.cost ? [{ label: '消耗', value: skill.cost }] : []),
  ];
  return (
    <More id={id}>
      {skill.proficiency && (
        <Bar label="熟练" current={skill.proficiency.current} max={skill.proficiency.max} tone="gold" />
      )}
      {facts.length > 0 && <KV items={facts} />}
      <p>{skill.text}</p>
    </More>
  );
}

export function Skills(_props: { saveId: string }) {
  const view = useStateStore((s) => s.view);
  const aim = useAim('skills');
  const skills = view?.skills ?? [];
  const aimed = skills.find((skill) => skill.id === aim?.pick);
  const [tab, setTab] = useState<Kind>(() => {
    if (aimed) return aimed.kind;
    if (isKind(aim?.tab)) return aim.tab;
    // open on the first tab that has something in it
    return SKILL_TABS.find((t) => skills.some((skill) => skill.kind === t.id))?.id ?? 'technique';
  });
  const [open, setOpen] = useState<string | null>(aimed?.id ?? null);
  const paneId = useId();
  const moreId = useId();

  if (!view) return <Loading text="载入中……" />;
  const shown = skills.filter((skill) => skill.kind === tab);
  const label = SKILL_TABS.find((t) => t.id === tab)?.label ?? '';

  return (
    <>
      <div className={common.tabsRow}>
        <Tabs
          label="技能分类"
          items={SKILL_TABS}
          value={tab}
          controls={paneId}
          onChange={(id) => {
            if (isKind(id)) setTab(id);
          }}
        />
      </div>
      <div id={paneId} className={common.pane} role="tabpanel" aria-label={label}>
        {skills.length === 0 ? (
          <Empty title="尚无技能" text="学会的功法、法术和杂学会列在这里。" />
        ) : shown.length === 0 ? (
          <Empty title={`尚无${label}`} text={`学会的${label}会列在这里。`} />
        ) : (
          <ul className={common.list}>
            {shown.map((skill) => {
              const expanded = open === skill.id;
              return (
                <li key={skill.id}>
                  <Entry
                    className={common.tall}
                    title={skill.name}
                    text={expanded ? undefined : <span className={common.oneLine}>{skill.text}</span>}
                    status={skill.layer}
                    selected={expanded}
                    onClick={() => setOpen(expanded ? null : skill.id)}
                  />
                  {expanded && <SkillMore id={`${moreId}-${skill.id}`} skill={skill} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
