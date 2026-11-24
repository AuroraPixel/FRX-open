// 阵法 (gameplay plan item 43): the arrays laid where the player is (play.arrays: the standing ones, 聚灵 禁制
// 隐匿 护府, and the ones laid before a fight, 困 杀 幻 护, on their ground), each with its tier, its power
// when it was laid badly and the stones it holds; 布阵 (which array, the disc or the flags: the best the
// 布阵 mastery reaches when left to it, the stones a fight array or a 护府 holds, whom to lure in) as
// verb array after its preview; and the place's teleport array: where it goes and for how much (a
// crossing is verb travel after its preview), or, broken, the errand that mends it (verb array repair).
import { useState } from 'react';
import type { Character, Item, LaidArray, PlayArrays, Verb } from '../../contracts';
import { chineseNumber } from '../../lib/numerals';
import { useStateStore } from '../../store/state';
import { Btn } from '../../ui/Btn';
import { Empty, Loading, NOVEL_SAVE } from '../../ui/Loading';
import { Sub } from '../../ui/Sub';
import shop from './Shop.module.css';
import { Options, Said, VerbDetail } from './VerbDetail';
import styles from './Arrays.module.css';

/** The arrays, in the panel's order: the standing ones, then the ones laid before a fight. */
export const ARRAY_NAMES = ['聚灵', '禁制', '隐匿', '护府', '困', '杀', '幻', '护'] as const;
export type ArrayName = (typeof ARRAY_NAMES)[number];
const STANDING: readonly ArrayName[] = ['聚灵', '禁制', '隐匿', '护府'];

/** Each array's name, the disc or flags it takes (content/life/arrays.json's tools, a tier's prefix
 *  before them: 二阶聚灵阵盘) and what it does. */
export const ARRAYS: Record<ArrayName, { label: string; tool: string; text: string }> = {
  聚灵: { label: '聚灵阵', tool: '聚灵阵盘', text: '常设：在这里修炼，灵气每阶添一成' },
  禁制: { label: '禁制', tool: '禁制阵盘', text: '常设：在这里闭关不被打扰' },
  隐匿: { label: '隐匿阵', tool: '迷踪阵盘', text: '常设：冲着这里来的钟涨得慢一半' },
  护府: { label: '护府阵', tool: '护府阵盘', text: '常设：有人打上门来，那场斗法自带护阵和困阵' },
  困: { label: '困阵', tool: '困阵旗', text: '战前：阵里的对手遁不走，脚力按一半算' },
  杀: { label: '杀阵', tool: '杀阵旗', text: '战前：每回合对阵里的对手打一手' },
  幻: { label: '幻阵', tool: '幻阵旗', text: '战前：对手命中减四，第一手归你' },
  护: { label: '护阵', tool: '护阵旗', text: '战前：你和同伴受的伤害少三成' },
};

/** The stones a fight array or a 护府 may be given; none is the engine's own (ten rounds of its tier). */
const CHARGES = [0, 20, 40, 100] as const;

/** The bag's discs or flags for an array, by name (any tier). */
export function toolsFor(name: ArrayName, bag: readonly Item[]): Item[] {
  const tool = ARRAYS[name].tool;
  return bag.filter((item) => item.quantity > 0 && (item.name === tool || (/^[一二三四五六七八九]阶/.test(item.name) && item.name.endsWith(tool))));
}

/** 「一阶 · 阵力减半 · 存灵石二十 · 守洞府」 */
export function laidWords(array: LaidArray): string {
  return [
    array.tier,
    array.power < 1 ? '阵力减半' : '',
    array.charge !== undefined ? `存灵石${chineseNumber(array.charge)}` : '',
    array.ground ?? '',
  ]
    .filter(Boolean)
    .join(' · ');
}

const lurable = (people: readonly Character[]) => people.filter((person) => person.present && /^[CG]/.test(person.id));

function Lay({ saveId, onBack }: { saveId: string; onBack: () => void }) {
  const view = useStateStore((s) => s.view);
  // the first array the bag holds a disc or flags for, else 聚灵
  const [name, setName] = useState<ArrayName>(() => ARRAY_NAMES.find((each) => toolsFor(each, view?.bag ?? []).length > 0) ?? '聚灵');
  const [toolId, setToolId] = useState('');
  const [charge, setCharge] = useState(0);
  const [person, setPerson] = useState('');
  const tools = toolsFor(name, view?.bag ?? []);
  const tool = tools.find((item) => item.id === toolId);
  const charged = !STANDING.includes(name) || name === '护府';
  const fight = !STANDING.includes(name);
  const people = lurable(view?.people ?? []);
  const verb: Verb = {
    kind: 'array',
    name,
    ...(tool ? { item: tool.id } : {}),
    ...(charged && charge ? { charge } : {}),
    ...(fight && person ? { person } : {}),
  };
  return (
    <VerbDetail saveId={saveId} verb={verb} title="布阵" sub={view?.play?.place?.name} glyph="阵" name="布阵" onBack={onBack}>
      {/* the standing four over the fight's four */}
      <Options
        label="布哪一种"
        options={ARRAY_NAMES.map((each) => ({ id: each, label: ARRAYS[each].label }))}
        value={name}
        onChange={(each) => {
          setName(each);
          setToolId('');
          setCharge(0);
          setPerson('');
        }}
      />
      <Said>{ARRAYS[name].text}</Said>
      {tools.length > 0 ? (
        <Options
          label={ARRAYS[name].tool.endsWith('旗') ? '用哪一套阵旗' : '用哪一面阵盘'}
          options={[{ id: '', label: '手艺够得着的最好那件' }, ...tools.map((item) => ({ id: item.id, label: `${item.name}（${item.quantity}）` }))]}
          value={toolId}
          onChange={setToolId}
          columns={2}
        />
      ) : (
        <p className={shop.none}>储物袋里没有{ARRAYS[name].tool}。</p>
      )}
      {charged && (
        <Options
          label="放几块灵石"
          options={CHARGES.map((each) => ({ id: String(each), label: each ? `${chineseNumber(each)}块` : '够十回合' }))}
          value={String(charge)}
          onChange={(each) => setCharge(Number(each))}
        />
      )}
      {fight && (
        <>
          <Said>战前的阵只在自己挑的战场布得成：洞府里、抢在对方发觉之前伏击，或者把人引进来。</Said>
          {people.length > 0 && (
            <Options
              label="引谁进来"
              options={[{ id: '', label: '不引人' }, ...people.map((each) => ({ id: each.id, label: each.name }))]}
              value={person}
              onChange={setPerson}
              columns={3}
            />
          )}
        </>
      )}
    </VerbDetail>
  );
}

function Laid({ arrays }: { arrays: PlayArrays }) {
  const rows = [...arrays.laid, ...arrays.field];
  if (!rows.length) return <p className={shop.none}>这里还没布阵。</p>;
  return (
    <ul className={styles.rows}>
      {rows.map((array) => (
        <li key={array.id} className={styles.row} data-weak={array.power < 1 ? '' : undefined}>
          <span className={styles.what}>
            <b>{array.label}</b>
            <small>{laidWords(array)}</small>
          </span>
        </li>
      ))}
    </ul>
  );
}

type Doing = { kind: 'lay' } | { kind: 'cross'; to: string } | { kind: 'repair' };

export function ArraysSheet({ saveId }: { saveId: string }) {
  const view = useStateStore((s) => s.view);
  const [doing, setDoing] = useState<Doing | null>(null);
  if (!view) return <Loading />;
  if (!view.play) return <Empty title="没有阵法" text={NOVEL_SAVE} />;
  const back = () => setDoing(null);
  if (doing?.kind === 'lay') return <Lay saveId={saveId} onBack={back} />;
  if (doing?.kind === 'cross') {
    const link = view.play.arrays?.station?.links.find((each) => each.to === doing.to);
    return (
      <VerbDetail
        saveId={saveId}
        verb={{ kind: 'travel', to: doing.to }}
        title={`往${doing.to}`}
        sub={link ? `传送阵 · 一趟${chineseNumber(link.stones)}块灵石` : '传送阵'}
        glyph="传"
        name="传送"
        onBack={back}
      />
    );
  }
  if (doing?.kind === 'repair') {
    return <VerbDetail saveId={saveId} verb={{ kind: 'array', repair: true }} title="修传送阵" sub={view.play.arrays?.station?.repair} glyph="修" name="接差事" onBack={back} />;
  }
  const arrays = view.play.arrays ?? { laid: [], field: [] };
  const station = arrays.station;
  return (
    <div className={styles.arrays}>
      {view.play.place && (
        <p className={styles.here}>
          <b>此处</b>
          {view.play.place.name}
        </p>
      )}
      <section aria-label="布着的阵">
        <Sub>布着的阵</Sub>
        <Laid arrays={arrays} />
        <div className={styles.actions}>
          <Btn onClick={() => setDoing({ kind: 'lay' })}>布阵</Btn>
        </div>
      </section>
      {station && (
        <section aria-label="传送阵">
          <Sub>传送阵</Sub>
          {station.broken ? (
            <>
              <p className={styles.broken}>残破着：要先办成「{station.repair}」，才通得了。</p>
              <div className={styles.actions}>
                <Btn onClick={() => setDoing({ kind: 'repair' })}>接这件差事</Btn>
              </div>
            </>
          ) : null}
          <ul className={shop.rows} aria-label="通往">
            {station.links.map((link) => (
              <li key={link.to}>
                <button type="button" className={shop.row} onClick={() => setDoing({ kind: 'cross', to: link.to })}>
                  <span className={shop.what}>
                    <b>往{link.to}</b>
                    <small>{station.broken ? '修好之后才通' : '经传送阵，一日到'}</small>
                  </span>
                  <span className={shop.price}>
                    <b>{link.stones}</b>
                    <small>块灵石</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
