// 洞府 (gameplay plan item 45): the player's home as the state view has it (play.home): where it is and its
// 灵气, how it was had (bought, rented with the next rent's day, claimed, taken), its rooms (丹房, 器室: a
// missing one 修一间), the herb garden's beds with what grows and the day it ripens, the free plots (种药,
// and 收药 once one is ripe), the arrays laid there (阵法) and giving it up. Without one: the ways to have
// one here, 买下, 租下, 占一处 and 抢, each to its preview first (the engine's refusal says why a place
// does not allow it). Every doing is verb home { action, … } after its preview (VerbDetail).
import { useState } from 'react';
import type { Character, HomeBed, PlayHome, StateView, Verb } from '../../contracts';
import { chineseNumber } from '../../lib/numerals';
import { useStateStore } from '../../store/state';
import { useUiStore } from '../../store/ui';
import { Btn } from '../../ui/Btn';
import { Empty, Loading, NOVEL_SAVE } from '../../ui/Loading';
import { Sub } from '../../ui/Sub';
import { dateWords, todayOf } from './Cultivate';
import shop from './Shop.module.css';
import { Options, Said, Stepper, VerbDetail } from './VerbDetail';
import styles from './Home.module.css';

export type HomeAction = NonNullable<Verb['action']>;
type Room = '丹房' | '器室';
const ROOMS: readonly Room[] = ['丹房', '器室'];
const two = (n: number) => (n === 2 ? '两' : chineseNumber(n));

/** What each doing is called, on its button and over its preview. */
export const HOME_WORDS: Record<HomeAction, { glyph: string; name: string; title: string }> = {
  buy: { glyph: '买', name: '买下', title: '买一处洞府' },
  rent: { glyph: '租', name: '租下', title: '租一处洞府' },
  claim: { glyph: '占', name: '占下', title: '占一处无主之地' },
  take: { glyph: '夺', name: '动手', title: '从人手里抢' },
  build: { glyph: '修', name: '修房', title: '修一间房' },
  plant: { glyph: '种', name: '种下', title: '药园种药' },
  harvest: { glyph: '收', name: '收药', title: '药园收药' },
  leave: { glyph: '弃', name: '弃了它', title: '弃了洞府' },
};

/** 「0002-02-03」 said: 「二月初三」, with the year when it is not this one. */
export function keyWords(key: string, view: StateView | null): string {
  const found = /^(\d{1,6})-(\d{1,2})-(\d{1,2})$/.exec(key);
  if (!found) return key;
  const day = { year: Number(found[1]), month: Number(found[2]), day: Number(found[3]) };
  return dateWords(day, todayOf(view) ?? undefined);
}

/** How the home was had: 「买下的」「租的 · 每年三十块灵石 · 2年正月初五交下一年」「占下的」「夺来的」. */
export function howWords(home: PlayHome, view: StateView | null): string {
  if (home.how === 'rent' && home.rent) return `租的 · 每年${chineseNumber(home.rent.yearly)}块灵石 · ${keyWords(home.rent.due, view)}交下一年`;
  return { buy: '买下的', rent: '租的', claim: '占下的', take: '夺来的' }[home.how];
}

/** A bed of the garden under its herb's name: 「两株 · 二月初三熟」, or 「两株 · 熟了」. */
export function bedWords(bed: HomeBed, view: StateView | null): string {
  return `${two(bed.count)}株 · ${bed.ripe ? '熟了' : `${keyWords(bed.due, view)}熟`}`;
}

/** Whom a home could be taken from: someone on the scene. */
const takeable = (people: readonly Character[]) => people.filter((person) => person.present && /^[CG]/.test(person.id));

export function HomeDoing({ saveId, action, room: given, onBack }: { saveId: string; action: HomeAction; room?: Room; onBack: () => void }) {
  const view = useStateStore((s) => s.view);
  // what the garden takes: the bag's herbs as the engine knows them (play.home.seeds)
  const herbs = view?.play?.home?.seeds ?? [];
  const people = takeable(view?.people ?? []);
  const [room, setRoom] = useState<Room>(given ?? (view?.play?.home?.rooms.includes('丹房') ? '器室' : '丹房'));
  const [herbId, setHerbId] = useState(herbs[0]?.id ?? '');
  const [count, setCount] = useState(1);
  const [person, setPerson] = useState(people[0]?.id ?? '');
  const herb = herbs.find((item) => item.id === herbId);
  const verb: Verb = {
    kind: 'home',
    action,
    ...(action === 'build' ? { room } : {}),
    ...(action === 'plant' && herb ? { item: herb.id, count } : {}),
    ...(action === 'take' && person ? { person } : {}),
  };
  const words = HOME_WORDS[action];
  return (
    <VerbDetail saveId={saveId} verb={verb} title={words.title} sub={view?.play?.place?.name} glyph={words.glyph} name={words.name} onBack={onBack}>
      {action === 'build' && (
        <>
          <Options label="修哪一间" options={ROOMS.map((each) => ({ id: each, label: each }))} value={room} onChange={setRoom} columns={2} />
          <Said>丹房里炼丹、制符，器室里炼器、布阵。</Said>
        </>
      )}
      {action === 'plant' &&
        (herbs.length ? (
          <>
            <Options
              label="种什么"
              options={herbs.map((item) => ({ id: item.id, label: item.name }))}
              value={herbId}
              onChange={(id) => {
                setHerbId(id);
                setCount(1);
              }}
              columns={3}
            />
            <Stepper label="种几株" value={count} min={1} max={Math.max(1, herb?.count ?? 1)} unit="株" onChange={setCount} />
          </>
        ) : (
          <p className={shop.none}>储物袋里没有能种的灵草。</p>
        ))}
      {action === 'take' &&
        (people.length ? (
          <Options label="从谁手里" options={people.map((each) => ({ id: each.id, label: each.name }))} value={person} onChange={setPerson} columns={3} />
        ) : (
          <p className={shop.none}>眼前没有人，抢不了。</p>
        ))}
    </VerbDetail>
  );
}

function HomeView({ home, view, onDo }: { home: PlayHome; view: StateView; onDo: (action: HomeAction, room?: Room) => void }) {
  const openSheet = useUiStore((s) => s.openSheet);
  const free = Math.max(0, home.plots - home.garden.length);
  const ripe = home.garden.some((bed) => bed.ripe);
  const laid = view.play?.arrays && home.here ? view.play.arrays.laid.length + view.play.arrays.field.length : 0;
  return (
    <div className={styles.home}>
      <header className={styles.head}>
        <h3>{home.name}</h3>
        <p>
          {[`灵气${home.aura}`, howWords(home, view)].join(' · ')}
          {!home.here && <span className={styles.away}>人不在洞府里</span>}
        </p>
      </header>
      <section aria-label="房">
        <Sub>房</Sub>
        <ul className={styles.rows}>
          {ROOMS.map((room) => {
            const built = home.rooms.includes(room);
            return (
              <li key={room} className={styles.row}>
                <span className={styles.what}>
                  <b>{room}</b>
                  <small>{built ? '修好了' : '还没修'}</small>
                </span>
                {!built && <Btn onClick={() => onDo('build', room)}>修一间</Btn>}
              </li>
            );
          })}
        </ul>
      </section>
      <section aria-label="药园">
        <Sub>药园</Sub>
        {home.garden.length > 0 ? (
          <ul className={styles.rows} aria-label="种着的">
            {home.garden.map((bed) => (
              <li key={bed.id} className={styles.row} data-ripe={bed.ripe ? '' : undefined}>
                <span className={styles.what}>
                  <b>{bed.herb}</b>
                  <small>{bedWords(bed, view)}</small>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={shop.none}>药园里还没种东西。</p>
        )}
        <p className={styles.plots}>
          {free > 0 ? `还空着${two(free)}畦，共${two(home.plots)}畦` : `${two(home.plots)}畦都种着`}
        </p>
        <div className={styles.actions}>
          {free > 0 && <Btn onClick={() => onDo('plant')}>种药</Btn>}
          {ripe && (
            <Btn variant="solid" onClick={() => onDo('harvest')}>
              收药
            </Btn>
          )}
        </div>
      </section>
      <div className={styles.actions}>
        <Btn onClick={() => openSheet('arrays')}>{laid ? `阵法 · 布着${two(laid)}座` : '阵法'}</Btn>
        <Btn onClick={() => onDo('leave')}>弃了它</Btn>
      </div>
    </div>
  );
}

function NoHome({ view, onDo }: { view: StateView; onDo: (action: HomeAction) => void }) {
  const here = view.play?.place;
  const ways: { action: HomeAction; text: string }[] = [
    { action: 'buy', text: '城镇、坊市里一次付清，价照此地的灵气' },
    { action: 'rent', text: '城镇、坊市里先付头一年，往后每年这一天交，交不起就被收回' },
    { action: 'claim', text: '山野、灵地这些无主之地，寻几日、掷一次检定，危险照旧' },
    { action: 'take', text: '从在场的人手里抢：斗一场，赢了归你，也结下仇' },
  ];
  return (
    <div className={styles.home}>
      <Empty title="还没有洞府" text={here ? `此处是${here.name}（${here.kind}）。` : undefined} />
      <ul className={shop.rows} aria-label="来路">
        {ways.map((way) => (
          <li key={way.action}>
            <button type="button" className={shop.row} onClick={() => onDo(way.action)}>
              <span className={shop.what}>
                <b>{HOME_WORDS[way.action].title}</b>
                <small>{way.text}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HomeSheet({ saveId }: { saveId: string }) {
  const view = useStateStore((s) => s.view);
  const [doing, setDoing] = useState<{ action: HomeAction; room?: Room } | null>(null);
  if (!view) return <Loading />;
  if (!view.play) return <Empty title="没有洞府" text={NOVEL_SAVE} />;
  if (doing) return <HomeDoing key={`${doing.action}:${doing.room ?? ''}`} saveId={saveId} action={doing.action} room={doing.room} onBack={() => setDoing(null)} />;
  const home = view.play.home;
  const go = (action: HomeAction, room?: Room) => setDoing({ action, ...(room ? { room } : {}) });
  return home ? <HomeView home={home} view={view} onDo={go} /> : <NoHome view={view} onDo={go} />;
}
