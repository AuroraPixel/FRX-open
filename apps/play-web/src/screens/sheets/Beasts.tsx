// 灵兽 (plan item 45; spec 七, 灵兽): each beast with its picture from the bestiary (the generic
// silhouette when the bestiary has no such species), name and level; a picked one opens to its
// numbers, aptitude and affection, what it is like and its skills, and can be fed (the old page's
// 喂食/培养): one of the bag's consumables moves its aptitude at random and its affection up one; an
// aptitude that fills breaks through to the next grade, which the next turn tells. The cultivation life has
// its own panel (LifeBeasts.tsx).
import { useId, useState } from 'react';
import { actions } from '../../api/actions';
import type { Beast, Item, PanelResult } from '../../contracts';
import { useStateStore } from '../../store/state';
import { Btn } from '../../ui/Btn';
import { KV } from '../../ui/KV';
import { Empty, Loading } from '../../ui/Loading';
import { usePanelAction } from './act';
import { useAim } from './aim';
import { LifeBeasts } from './LifeBeasts';
import { More } from './More';
import { useReveal } from './reveal';
import { type BeastPicture, beastPicture, useArt } from './art';
import common from './common.module.css';
import styles from './Beasts.module.css';

/** What a feed did, in the player's words, from the beast before and after it. */
export function fedWords(beast: Beast, food: Item, result: PanelResult): string {
  const now = result.state.beasts.find((b) => b.id === beast.id)?.aptitude;
  const was = beast.aptitude;
  if (result.queue?.length && now) return `${beast.name}血脉蜕变，晋为${now.tier}，下一回合写进剧情。`;
  if (!was || !now || was.tier !== now.tier) return `喂了${food.name}。`;
  const moved = now.current - was.current;
  if (now.current >= now.max && moved >= 0) return `喂了${food.name}，${beast.name}已达此界巅峰。`;
  if (moved > 0) return `喂了${food.name}，${beast.name}资质 +${moved}。`;
  if (moved < 0) return `喂了${food.name}，${beast.name}有些排斥，资质 ${moved}。`;
  return `喂了${food.name}，${beast.name}毫无波澜。`;
}

function Feeding({ saveId, beast, foods }: { saveId: string; beast: Beast; foods: Item[] }) {
  const [open, setOpen] = useState(false);
  // on a phone the list opens under the fold: brought into sight, with room for the touch areas
  const listRef = useReveal<HTMLDivElement>(open ? beast.id : null);
  const { run, blocked, busy } = usePanelAction(saveId);
  const feed = (food: Item) =>
    run((version) => actions.feed(saveId, version, beast.id, food.id), (result) => fedWords(beast, food, result));
  return (
    <>
      <div className={common.actions}>
        <Btn onClick={() => setOpen(!open)} aria-expanded={open} disabled={foods.length === 0}>
          投喂
        </Btn>
        {open && foods.length > 0 && (
          <div
            ref={listRef}
            className={`${styles.feed} ${common.revealed}`}
            role="group"
            aria-label={`喂${beast.name}什么`}
          >
            <span className={styles.feedLabel}>喂</span>
            {foods.map((food) => (
              <Btn key={food.id} onClick={() => void feed(food)} disabled={blocked}>
                {food.name}
                {food.quantity > 1 ? ` ×${food.quantity}` : ''}
              </Btn>
            ))}
          </div>
        )}
      </div>
      {foods.length === 0 && <p className={common.note}>行囊里没有丹药，无从投喂。</p>}
      {open && busy && <p className={common.note}>这一回合写完之后才能投喂。</p>}
    </>
  );
}

function BeastMore({
  id,
  saveId,
  beast,
  picture,
  foods,
}: {
  id: string;
  saveId: string;
  beast: Beast;
  picture: BeastPicture;
  foods: Item[];
}) {
  const aptitude = beast.aptitude;
  return (
    <More id={id}>
      <KV
        items={[
          { label: '阶位', value: beast.level ?? '未明' },
          { label: '物种', value: picture.known ? picture.label : '图鉴未载' },
          { label: '气血', value: beast.hp ?? '—' },
          { label: '法力', value: beast.mp ?? '—' },
          // as in the old page's feeding header: 资质 is the grade, 进度 how far into it the beast has come
          ...(aptitude
            ? [
                { label: '资质', value: aptitude.tier },
                { label: '进度', value: `${aptitude.current} / ${aptitude.max}` },
              ]
            : []),
          ...(beast.affection !== undefined ? [{ label: '好感', value: String(beast.affection) }] : []),
        ]}
      />
      <p>{beast.text}</p>
      {beast.skills && (
        <div className={styles.skills}>
          <span>技能</span>
          <p>{beast.skills}</p>
        </div>
      )}
      <Feeding saveId={saveId} beast={beast} foods={foods} />
    </More>
  );
}

export function Beasts({ saveId }: { saveId: string }) {
  const view = useStateStore((s) => s.view);
  const aim = useAim('beasts');
  const [open, setOpen] = useState<string | null>(aim?.pick ?? null);
  const moreId = useId();
  const { bestiary } = useArt();

  if (!view) return <Loading text="载入中……" />;
  // the cultivation life has its own (LifeBeasts.tsx: play.beasts, the engine's beasts)
  if (view.play?.beasts) return <LifeBeasts saveId={saveId} beasts={view.play.beasts} bag={view.bag} />;
  if (view.beasts.length === 0) return <Empty title="尚无灵兽" text="收服的灵兽会在这里。" />;
  // the feeding window lists the bag's consumables (the old page's 消耗品)
  const foods = view.bag.filter((item) => item.type === '消耗品');

  return (
    <ul className={common.list}>
      {view.beasts.map((beast) => {
        const picture = beastPicture(bestiary, beast.species);
        const expanded = open === beast.id;
        const id = `${moreId}-${beast.id}`;
        return (
          <li key={beast.id}>
            <button
              type="button"
              className={styles.beast}
              aria-expanded={expanded}
              aria-controls={expanded ? id : undefined}
              onClick={() => setOpen(expanded ? null : beast.id)}
            >
              <span className={styles.picture} data-known={picture.known ? '' : undefined}>
                <img src={picture.url} alt="" />
              </span>
              <span className={styles.words}>
                <strong className={styles.name}>{beast.name}</strong>
                <span className={styles.level}>
                  {beast.level ?? '阶位未明'}
                  {picture.known ? ` · ${picture.label}` : ''}
                </span>
                {!expanded && <span className={`${styles.text} ${common.oneLine}`}>{beast.text}</span>}
              </span>
            </button>
            {expanded && <BeastMore id={id} saveId={saveId} beast={beast} picture={picture} foods={foods} />}
          </li>
        );
      })}
    </ul>
  );
}
