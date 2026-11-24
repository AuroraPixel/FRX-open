// The creation's plain steps: difficulty (with the world's factors), birth, race and gender (with the age and
// the 人称), attributes, and the summary with 踏入仙途. The draws, the portrait and the birthplace have files of
// their own.
import { useEffect, useId, useState } from 'react';
import type { CreationOptions } from '../../contracts';
import { Act } from '../../ui/Act';
import { Sub } from '../../ui/Sub';
import { Head } from '../portrait/Head';
import { Choice } from './Choice';
import { rootParts } from './RootStep';
import {
  AGE, type Creation, PRONOUNS, SEX_OF_GENDER, bonusOf, bonusSaid, canAfford, claimedTraits, pointsLeft, pointsTotal,
} from './rules';
import { useCreation } from './store';
import styles from './Creation.module.css';

interface StepProps {
  options: CreationOptions;
  c: Creation;
}

const costSaid = (cost: number) => (cost > 0 ? `${cost} 点` : cost < 0 ? `返 ${-cost} 点` : '');

export function DifficultyStep({ options, c }: StepProps) {
  const change = useCreation((s) => s.change);
  const factors = Object.entries(options.config.WORLD_FACTORS);
  const own = options.custom.worldFactors.filter(
    (f): f is { id: string; name: string; description?: string; effect?: string } =>
      typeof f.id === 'string' && typeof f.name === 'string',
  );
  const toggle = (name: string) =>
    change({ worldFactors: c.worldFactors.includes(name) ? c.worldFactors.filter((f) => f !== name) : [...c.worldFactors, name] });
  return (
    <>
      <p className={styles.lead}>难度定下你起步的点数；越难，可以分配的越少。</p>
      <div className={styles.choices} role="group" aria-label="难度">
        {Object.entries(options.config.DIFFICULTIES).map(([name, data]) => (
          <Choice
            key={name}
            title={name}
            cost={data!.points >= 99999 ? '点数不计' : `${data!.points} 点`}
            text={data!.desc ?? (data!.extreme ? '会死，死了删档' : undefined)}
            chosen={c.difficulty === name}
            onChoose={() => change({ difficulty: name })}
          />
        ))}
      </div>
      <Sub>世界因子 · 可不选</Sub>
      <p className={styles.lead}>给这个世界加一点变数：它会改变这片天地的规矩和人心。</p>
      <div className={styles.choices} role="group" aria-label="世界因子">
        {factors.map(([name, data]) => (
          <Choice
            key={name}
            title={name}
            text={data!.effect}
            chosen={c.worldFactors.includes(name)}
            onChoose={() => toggle(name)}
          />
        ))}
        {own.map((factor) => (
          <Choice
            key={factor.id}
            title={factor.name}
            text={factor.effect ?? factor.description}
            chosen={c.worldFactors.includes(factor.id)}
            onChoose={() => toggle(factor.id)}
          />
        ))}
      </div>
    </>
  );
}

export function BirthStep({ options, c }: StepProps) {
  const change = useCreation((s) => s.change);
  return (
    <>
      <p className={styles.lead}>你生在哪里、长在谁家，决定了起步的际遇。</p>
      <div className={styles.choices} role="group" aria-label="出身">
        {Object.entries(options.config.BIRTHS).map(([name, data]) => (
          <Choice
            key={name}
            title={name}
            cost={costSaid(data!.cost)}
            bonus={bonusSaid(data!.bonus)}
            text={data!.desc}
            chosen={c.birth === name}
            blocked={canAfford(options, c, 'birth', name) ? undefined : '点数不够'}
            onChoose={() => change({ birth: name })}
          />
        ))}
      </div>
    </>
  );
}

/** 初始年龄: typed freely, kept between 1 and 999 (the page's input), back to the last good age when left empty. */
function AgeField({ age }: { age: number }) {
  const change = useCreation((s) => s.change);
  const id = useId();
  const [text, setText] = useState(String(age));
  useEffect(() => setText(String(age)), [age]);
  const typed = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 3);
    setText(digits);
    const n = Number(digits);
    if (digits && n >= AGE.min && n <= AGE.max) change({ age: n });
  };
  return (
    <div className={styles.ageField}>
      <label htmlFor={id}>初始年龄</label>
      <input
        id={id}
        className={styles.input}
        inputMode="numeric"
        autoComplete="off"
        value={text}
        aria-describedby={`${id}-unit`}
        onChange={(event) => typed(event.target.value)}
        onBlur={() => setText(String(age))}
      />
      <span id={`${id}-unit`} className={styles.ageUnit}>
        岁（{AGE.min}–{AGE.max}）
      </span>
    </div>
  );
}

export function RaceStep({ options, c }: StepProps) {
  const change = useCreation((s) => s.change);
  return (
    <>
      <Sub>性别</Sub>
      <div className={styles.pair} role="radiogroup" aria-label="性别">
        {Object.entries(options.config.GENDERS).map(([name, data]) => (
          <Choice
            key={name}
            title={name}
            text={data?.effects.join('；')}
            chosen={c.gender === name}
            onChoose={() => change({ gender: name, sex: SEX_OF_GENDER[name] ?? 'm' })}
          />
        ))}
      </div>
      <Sub>年龄与人称</Sub>
      <AgeField age={c.age} />
      <div className={styles.trio} role="radiogroup" aria-label="人称">
        {PRONOUNS.map((pronoun) => (
          <Choice
            key={pronoun.id}
            title={pronoun.id}
            text={pronoun.said}
            chosen={c.pronoun === pronoun.id}
            onChoose={() => change({ pronoun: pronoun.id })}
          />
        ))}
      </div>
      <Sub>种族</Sub>
      <div className={styles.choices} role="group" aria-label="种族">
        {Object.entries(options.config.RACES).map(([name, data]) => (
          <Choice
            key={name}
            title={name}
            cost={costSaid(data!.cost)}
            bonus={bonusSaid(data!.bonus)}
            text={data!.desc}
            chosen={c.race === name}
            blocked={canAfford(options, c, 'race', name) ? undefined : '点数不够'}
            onChoose={() => change({ race: name })}
          />
        ))}
      </div>
    </>
  );
}

export function AttributesStep({ options, c }: StepProps) {
  const setAttribute = useCreation((s) => s.setAttribute);
  const left = pointsLeft(options, c);
  const max = options.rules.attributeMax;
  return (
    <>
      <p className={styles.lead}>
        剩下的点数分给十一项属性，每项至多 {max}。出身、种族和词条的加成在开局时另算，写在后面。
      </p>
      <dl className={styles.attributes}>
        {Object.entries(options.config.ATTRIBUTES).map(([key, text]) => {
          const value = c.attributes[key] ?? 0;
          const bonus = bonusOf(options, c, key);
          return (
            <div key={key} className={styles.attribute}>
              <dt title={text}>
                <span>{key}</span>
                <small>{text}</small>
              </dt>
              <dd>
                <button
                  type="button"
                  className={styles.step}
                  aria-label={`${key}减一`}
                  disabled={value <= 0}
                  onClick={() => setAttribute(key, value - 1)}
                >
                  −
                </button>
                <output className={styles.value} aria-label={`${key} ${value}`}>
                  {value}
                </output>
                <button
                  type="button"
                  className={styles.step}
                  aria-label={`${key}加一`}
                  disabled={value >= max || left <= 0}
                  onClick={() => setAttribute(key, value + 1)}
                >
                  ＋
                </button>
                <em
                  className={styles.delta}
                  data-negative={bonus < 0 ? '' : undefined}
                  aria-label={bonus ? `加成 ${bonus}` : undefined}
                >
                  {bonus ? `${bonus > 0 ? '+' : ''}${bonus}` : ''}
                </em>
              </dd>
            </div>
          );
        })}
      </dl>
    </>
  );
}

/** 「伪灵根 火,土,水,金」 → 「伪灵根 火、土、水、金」 */
function rootSaid(root: string | null): string {
  if (!root) return '';
  const { kind, elements } = rootParts(root);
  return [kind, elements.join('、')].filter(Boolean).join(' ');
}

export function SummaryStep({
  options,
  c,
  onEnter,
  problem,
}: StepProps & { onEnter: () => void; problem: string | null }) {
  const submitting = useCreation((s) => s.submitting);
  const go = useCreation((s) => s.go);
  const left = pointsLeft(options, c);
  const where = c.birthplace
    ? [c.birthplace.regionId, c.birthplace.areaId === c.birthplace.regionId ? '' : c.birthplace.areaId, c.birthplace.poiId]
        .filter(Boolean)
        .join(' · ')
    : '尚未选';
  const rows: { label: string; value: string; step: number }[] = [
    { label: '难度', value: `${c.difficulty ?? ''}（${pointsTotal(options, c)} 点）`, step: 0 },
    { label: '世界因子', value: c.worldFactors.join('、') || '无', step: 0 },
    { label: '出身', value: c.birth ?? '', step: 1 },
    { label: '种族', value: `${c.race ?? ''} · ${c.gender ?? (c.sex === 'f' ? '女性' : '男性')}`, step: 2 },
    { label: '年龄与人称', value: `${c.age} 岁 · ${c.pronoun}`, step: 2 },
    { label: '灵根', value: rootSaid(c.root), step: 3 },
    { label: '词条', value: claimedTraits(c).join('、') || '无', step: 4 },
    {
      label: '属性',
      value:
        Object.entries(c.attributes)
          .filter(([, v]) => v > 0)
          .map(([k, v]) => `${k} ${v}`)
          .join(' · ') || '未分配',
      step: 5,
    },
    { label: '出生地', value: where, step: 7 },
  ];
  return (
    <>
      <div className={styles.summaryTop}>
        {c.portrait && <Head recipe={c.portrait} name={c.name || '你'} size={56} />}
        <div>
          <strong className={styles.summaryName}>{c.name.trim() || '无名'}</strong>
          <span className={styles.lead}>剩余点数 {left}{left > 0 ? '，开局后不再能用' : ''}</span>
        </div>
      </div>
      <dl className={styles.summary}>
        {rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>
              <span>{row.value}</span>
              <button type="button" className={styles.edit} onClick={() => go(row.step)} aria-label={`改${row.label}`}>
                改
              </button>
            </dd>
          </div>
        ))}
      </dl>
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      <Act
        glyph="入"
        name="踏入仙途"
        note={submitting ? '开辟洞天中……' : '建下存档，开始第一回'}
        hot={!submitting}
        unavailable={submitting || left < 0}
        onClick={onEnter}
        className={styles.enter}
      />
    </>
  );
}
