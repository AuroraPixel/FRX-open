// 灵兽 in the cultivation life (gameplay plan item 41; play.beasts, the engine's beasts.view): how many are kept
// (eggs count) of how many the player can keep, then each beast: its picture from the bestiary, name, level,
// temperament, and its marks — out with the player, bound or the days of binding left, whether it heeds
// orders, hurt and the days to heal, this month's feeds of three. Pressed, it opens to its aptitude, 气血 and
// 法力, favour, its use and what it does by itself, and what can be done: 喂养 (a food from the bag the engine
// lists, with its tier's factor and what a feed may bring), 出战 or 收回, 升阶 (a thing of the next tier), each a
// panel action; 认主 (verb bind) after its preview. Then the eggs hatching, and the bag's eggs to hatch.
// A novel's save keeps the old panel (Beasts.tsx).
import { useId, useState } from 'react';
import { actions } from '../../api/actions';
import type { Item, PlayBeast, PlayBeasts, Verb } from '../../contracts';
import { chineseNumber } from '../../lib/numerals';
import { useStateStore } from '../../store/state';
import { useTurnsStore } from '../../store/turns';
import { useUiStore } from '../../store/ui';
import { Act } from '../../ui/Act';
import { Bar } from '../../ui/Bar';
import { Btn } from '../../ui/Btn';
import { Empty } from '../../ui/Loading';
import { Sub } from '../../ui/Sub';
import { sendCommand } from '../play/commands';
import { usePanelAction } from './act';
import { beastPicture, useArt } from './art';
import { Preview, spanWords } from './Cultivate';
import days from './Cultivate.module.css';
import { Rows } from './Rows';
import { usePreview } from './usePreview';
import common from './common.module.css';
import styles from './LifeBeasts.module.css';

/** What a beast does by itself when it will not heed an order (FightOrder labels). */
export const ACTS: Record<string, string> = { attack: '扑击', guard: '护主', harass: '扰敌' };
/** What makes an egg (content/life/beasts.json hatch.words). */
const EGG_WORDS = ['兽卵', '卵', '蛋'];

const count = (n: number) => (n === 2 ? '两' : chineseNumber(n));

/** A beast's marks, in the order they show: 出战, its binding, 听令 or not, a hurt, this month's feeds. */
export function beastMarks(beast: PlayBeast): string[] {
  return [
    beast.out ? '出战' : '',
    beast.bound ? '已认主' : beast.bindDays ? `认主还差${count(beast.bindDays)}日` : '未认主',
    beast.heeds ? '听令' : '不听令',
    beast.hurtDays ? `伤重，还要养${count(beast.hurtDays)}日` : '',
    `本月喂了${count(beast.feeds.used)}回（共${count(beast.feeds.of)}回）`,
  ].filter(Boolean);
}

/** Why a beast cannot go out now, or null. */
export function outBlocked(beast: PlayBeast): string | null {
  if (!beast.bound) return '还没认主，不肯随你出战';
  if (beast.hurtDays) return `伤重，还要养${count(beast.hurtDays)}日`;
  return null;
}

/** The bag's eggs (兽卵, 卵, 蛋 in a name). */
export const eggsIn = (bag: readonly Item[]): Item[] => bag.filter((item) => EGG_WORDS.some((word) => item.name.includes(word)));

/** 「一阶 · ×1.5 · 资质 -5 到 +36，运气好 +72」 */
export function foodWords(food: PlayBeast['foods'][number]): string {
  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  return [food.tier, food.factor !== 1 ? `×${food.factor}` : '', food.same ? '同属' : '', `资质 ${sign(food.low)} 到 ${sign(food.high)}，运气好 ${sign(food.crit)}`]
    .filter(Boolean)
    .join(' · ');
}

type Picking = 'feed' | 'promote' | null;

function Bind({ saveId, beast }: { saveId: string; beast: PlayBeast }) {
  const view = useStateStore((s) => s.view);
  const closeSheet = useUiStore((s) => s.closeSheet);
  const busy = useTurnsStore((s) => s.live?.status === 'streaming' || s.live?.status === 'pending');
  const verb: Verb = { kind: 'bind', id: beast.id };
  const { preview, problem, asking } = usePreview(saveId, verb);
  const inScene = Boolean(view?.play?.scene || view?.play?.fight);
  const ready = Boolean(preview?.ok) && !asking && !busy && !inScene;
  const why = busy
    ? '这一回合写完之后才能认主。'
    : inScene
      ? '这场戏还没收场。'
      : asking
        ? '推算中……'
        : (problem ?? (preview && !preview.ok ? (preview.reason ?? '眼下认不了主。') : preview ? spanWords(preview.minutes) : ''));
  return (
    <div className={styles.bind}>
      <div className={days.preview} aria-label="预览" aria-busy={asking} data-stale={asking && preview ? '' : undefined}>
        {preview ? <Preview preview={preview} kind="bind" /> : !problem ? <p className={styles.note}>推算中……</p> : null}
        {problem && (
          <p className={days.reason} role="alert">
            {problem}
          </p>
        )}
      </div>
      <Act
        glyph="契"
        name="认主"
        note={why}
        hot={ready}
        unavailable={!ready}
        onClick={() => {
          if (ready && sendCommand({ verb })) closeSheet();
        }}
      />
    </div>
  );
}

function BeastMore({ saveId, beast, id }: { saveId: string; beast: PlayBeast; id: string }) {
  const { run, blocked } = usePanelAction(saveId);
  const [picking, setPicking] = useState<Picking>(null);
  const fedOut = beast.feeds.used >= beast.feeds.of;
  const blockedOut = outBlocked(beast);
  const nextTier = (beast.tier ?? 0) + 1;
  const promotable = beast.foods.filter((food) => {
    const tier = /([一二三四五六七八九])阶/.exec(food.tier ?? '')?.[1];
    return tier ? '一二三四五六七八九'.indexOf(tier) + 1 >= nextTier : false;
  });
  const feed = (itemId: string, name: string) => {
    setPicking(null);
    void run((version) => actions.feed(saveId, version, beast.id, itemId), `喂了${beast.name}${name}`);
  };
  const promote = (itemId: string, name: string) => {
    setPicking(null);
    void run((version) => actions.promote(saveId, version, beast.id, itemId), `${beast.name}服下${name}，升了一阶`);
  };
  return (
    <div id={id} className={styles.more}>
      <Bar label="资质" current={beast.aptitude.current} max={beast.aptitude.max} tone="gold" />
      <Bar label="气血" current={beast.hp.current} max={beast.hp.max} tone="hp" />
      <Bar label="法力" current={beast.mp.current} max={beast.mp.max} tone="mp" />
      <Rows
        rows={[
          { label: '品级', value: beast.aptitude.grade },
          { label: '好感', value: String(beast.favour) },
          { label: '性子', value: `${beast.temperament}${beast.act && ACTS[beast.act] ? ` · 不听令时自己${ACTS[beast.act]}` : ''}` },
          beast.use ? { label: '用处', value: `${beast.use.name}：${beast.use.text}` } : null,
        ]}
      />
      <div className={styles.actions} role="group" aria-label={`${beast.name}能做的事`}>
        <Btn
          onClick={() => setPicking(picking === 'feed' ? null : 'feed')}
          aria-expanded={picking === 'feed'}
          disabled={blocked || fedOut || beast.foods.length === 0}
        >
          喂养
        </Btn>
        {beast.out ? (
          <Btn onClick={() => void run((version) => actions.in(saveId, version, beast.id), `${beast.name}收回了`)} disabled={blocked}>
            收回
          </Btn>
        ) : (
          <Btn onClick={() => void run((version) => actions.out(saveId, version, beast.id), `${beast.name}随你出战`)} disabled={blocked || Boolean(blockedOut)}>
            出战
          </Btn>
        )}
        <Btn onClick={() => setPicking(picking === 'promote' ? null : 'promote')} aria-expanded={picking === 'promote'} disabled={blocked}>
          升阶
        </Btn>
      </div>
      {fedOut && <p className={styles.note}>这个月喂满了{count(beast.feeds.of)}回。</p>}
      {!beast.out && blockedOut && <p className={styles.note}>出战：{blockedOut}。</p>}
      {picking === 'feed' && (
        <ul className={styles.choices} aria-label={`喂${beast.name}什么`}>
          {beast.foods.map((food) => (
            <li key={food.itemId}>
              <button type="button" disabled={blocked} onClick={() => feed(food.itemId, food.name)}>
                <b>{food.name}</b>
                <span>{foodWords(food)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {picking === 'promote' &&
        (promotable.length ? (
          <ul className={styles.choices} aria-label={`给${beast.name}服下什么升阶`}>
            {promotable.map((food) => (
              <li key={food.itemId}>
                <button type="button" disabled={blocked} onClick={() => promote(food.itemId, food.name)}>
                  <b>{food.name}</b>
                  <span>{food.tier}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.note}>升到{chineseNumber(nextTier)}阶要一样{chineseNumber(nextTier)}阶以上的同系之物：同类的妖丹，或同属的灵物；储物袋里没有。</p>
        ))}
      {!beast.bound && <Bind saveId={saveId} beast={beast} />}
    </div>
  );
}

function Eggs({ saveId, beasts, bag }: { saveId: string; beasts: PlayBeasts; bag: readonly Item[] }) {
  const { run, blocked } = usePanelAction(saveId);
  const toHatch = eggsIn(bag);
  const full = beasts.kept >= beasts.cap;
  if (!beasts.eggs.length && !toHatch.length) return null;
  return (
    <section className={common.section} aria-label="兽卵">
      <Sub>兽卵</Sub>
      {beasts.eggs.length > 0 && (
        <ul className={styles.eggs}>
          {beasts.eggs.map((egg) => (
            <li key={egg.id}>
              <b>{egg.name}</b>
              <span>{[egg.tier, egg.days ? `还要${count(egg.days)}日破壳` : '今日破壳'].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ul>
      )}
      {toHatch.length > 0 && (
        <ul className={styles.choices} aria-label="储物袋里的兽卵">
          {toHatch.map((item) => (
            <li key={item.id}>
              <button type="button" disabled={blocked || full} onClick={() => void run((version) => actions.hatch(saveId, version, item.id), `孵起了${item.name}`)}>
                <b>孵化 · {item.name}</b>
                <span>{full ? '养满了，孵不了' : `持有 ${item.quantity}`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function LifeBeasts({ saveId, beasts, bag }: { saveId: string; beasts: PlayBeasts; bag: readonly Item[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const moreId = useId();
  const { bestiary } = useArt();
  const out = beasts.beasts.find((beast) => beast.id === beasts.out);
  return (
    <>
      <p className={styles.kept}>
        <b>
          养着 {beasts.kept} / {beasts.cap}
        </b>
        {out ? `随身出战：${out.name}` : '没有随身出战的灵兽'}
      </p>
      {beasts.beasts.length === 0 ? (
        <Empty title="尚无灵兽" text="降服、孵化或买来的灵兽会在这里。" />
      ) : (
        <ul className={common.list}>
          {beasts.beasts.map((beast) => {
            const picture = beastPicture(bestiary, beast.species ?? '');
            const expanded = open === beast.id;
            const id = `${moreId}-${beast.id}`;
            const marks = beastMarks(beast);
            return (
              <li key={beast.id}>
                <button
                  type="button"
                  className={styles.beast}
                  data-out={beast.out ? '' : undefined}
                  aria-expanded={expanded}
                  aria-controls={expanded ? id : undefined}
                  aria-label={`${beast.name}，${beast.level}，${beast.temperament}，${marks.join('，')}`}
                  onClick={() => setOpen(expanded ? null : beast.id)}
                >
                  <span className={styles.picture} data-known={picture.known ? '' : undefined}>
                    <img src={picture.url} alt="" />
                  </span>
                  <span className={styles.words}>
                    <strong>
                      {beast.name}
                      {beast.out && <i>出战</i>}
                    </strong>
                    <span className={styles.level}>
                      {beast.level} · {beast.temperament}
                      {beast.use ? ` · ${beast.use.name}` : ''}
                    </span>
                    <span className={styles.marks}>
                      {marks
                        .filter((mark) => mark !== '出战')
                        .map((mark) => (
                          <span key={mark} data-tone={/不听令|未认主|伤重|还差/.test(mark) ? 'warn' : undefined}>
                            {mark}
                          </span>
                        ))}
                    </span>
                  </span>
                </button>
                {expanded && <BeastMore saveId={saveId} beast={beast} id={id} />}
              </li>
            );
          })}
        </ul>
      )}
      <Eggs saveId={saveId} beasts={beasts} bag={bag} />
    </>
  );
}
