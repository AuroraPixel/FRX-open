// 人物与关系 (plan item 44; spec 七, 人物): who is here, who has been met, everyone; each with the round
// head cut from their portrait, name, role and the seal of how they stand with the player. A person opens to
// their half-length portrait (the kit's), their realm, role, whereabouts and relation, their deeds newest
// first, and what the old page's character card offered: 交谈 (a line said with the next turn: a `say` chip in
// the action queue), 标记羁绊 / 取消羁绊 (a panel action that takes effect at once) and 改形象: the portrait
// maker in a full-height panel, saved with PUT …/portrait. The new look goes into the state view at once, so
// the stage and the spoken lines' heads show it too.
import { type FormEvent, Suspense, lazy, useCallback, useEffect, useId, useRef, useState } from 'react';
import { actions } from '../../api/actions';
import { ApiError, play } from '../../api/client';
import { saves } from '../../api/saves';
import { audio } from '../../audio';
import type { Character, PeopleView, PersonDetail, Recipe, StateView } from '../../contracts';
import { useKit } from '../../kit/shared';
import { useStateStore } from '../../store/state';
import { useUiStore } from '../../store/ui';
import { Btn } from '../../ui/Btn';
import { KV } from '../../ui/KV';
import { Empty, Loading } from '../../ui/Loading';
import { Seal } from '../../ui/Marks';
import { Sheet } from '../../ui/Sheet';
import { Sub } from '../../ui/Sub';
import { Tabs } from '../../ui/Tabs';
import { useBeastFace } from '../play/foe';
import { lookChanged } from '../play/people';
import { Figure } from '../portrait/Figure';
import { Head } from '../portrait/Head';
import { sameLook } from '../portrait/parts';
import { queueChip, usePanelAction } from './act';
import { useAim } from './aim';
import common from './common.module.css';
import styles from './People.module.css';

type Tab = 'present' | 'known' | 'all';

// the portrait maker comes with 改形象, the first time it is opened
const PortraitMaker = lazy(() => import('../portrait/PortraitMaker').then((module) => ({ default: module.PortraitMaker })));

const TABS: { id: Tab; label: string }[] = [
  { id: 'present', label: '在场' },
  { id: 'known', label: '相识' },
  { id: 'all', label: '全部' },
];

function isTab(value: string | undefined): value is Tab {
  return TABS.some((tab) => tab.id === value);
}

/** One read of the play interface, again when `again` changes; the last answer stays while it reloads. */
function useRead<T>(load: () => Promise<T>, again: unknown) {
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
    // `again` stands for what the read depends on besides the loader
  }, [load, again, round]);
  return { data, error, retry: useCallback(() => setRound((n) => n + 1), []) };
}

/** The protagonist as one of the people: first among those here. */
function playerAsPerson(view: StateView): Character {
  return { ...view.player, role: view.player.role ?? '你自己', present: true };
}

/** The view with someone's new look, so the stage, the spoken lines and the panels show it at once. */
function withLook(view: StateView, charId: string, recipe: Recipe): StateView {
  if (view.player.id === charId) return { ...view, player: { ...view.player, portrait: recipe } };
  return { ...view, people: view.people.map((p) => (p.id === charId ? { ...p, portrait: recipe } : p)) };
}

function PersonEntry({ person, onOpen }: { person: Character; onOpen: () => void }) {
  // a beast the model lists among the people shows as its bestiary picture, not a portrait
  const beast = useBeastFace(person);
  return (
    <button
      type="button"
      className={styles.entry}
      onClick={onOpen}
      aria-label={[person.name, person.role, person.relation, person.bonded ? '羁绊' : null].filter(Boolean).join('，')}
    >
      <Head recipe={person.portrait} picture={beast} name={person.name} size={40} />
      <span className={styles.words}>
        <strong>
          {person.name}
          {person.bonded && <i className={styles.bond}>羁绊</i>}
        </strong>
        <span>{[person.role, person.realm].filter(Boolean).join(' · ')}</span>
      </span>
      {person.relation && <Seal glyph={person.relation} small className={styles.relation} />}
    </button>
  );
}

function Maker({
  saveId,
  person,
  onClose,
  onSaved,
}: {
  saveId: string;
  person: Character;
  onClose: () => void;
  onSaved: (recipe: Recipe) => void;
}) {
  const kit = useKit();
  const [recipe, setRecipe] = useState<Recipe>(person.portrait);
  const [busy, setBusy] = useState(false);
  const notify = useUiStore((s) => s.notify);
  const changed = !sameLook(recipe, person.portrait);

  const save = async () => {
    setBusy(true);
    try {
      const kept = await saves.setPortrait(saveId, person.id, recipe);
      audio.play('ui.seal');
      notify(`${person.name}的形象已保存`);
      onSaved(kept);
    } catch (problem) {
      audio.play('ui.error');
      notify(problem instanceof ApiError ? problem.message : new ApiError('network').message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="改形象" open size="tall" onClose={onClose} className={styles.makerSheet}>
      <div className={styles.makerFigure}>
        <Figure recipe={recipe} crop="half" label={`${person.name}的半身像`} />
      </div>
      {kit ? (
        <Suspense fallback={<Loading text="取部件……" />}>
          <PortraitMaker kit={kit} recipe={recipe} onChange={setRecipe} sex={person.sex} />
        </Suspense>
      ) : (
        <Loading text="取部件……" />
      )}
      <div className={styles.makerActions}>
        <Btn
          onClick={() => kit && setRecipe(kit.random(`${person.id}:${Date.now()}`, { base: recipe.base }))}
          disabled={!kit || busy}
        >
          随机
        </Btn>
        <Btn onClick={() => setRecipe(person.portrait)} disabled={!changed || busy}>
          还原
        </Btn>
        <Btn variant="solid" onClick={() => void save()} disabled={!changed || busy}>
          保存
        </Btn>
      </div>
    </Sheet>
  );
}

/** 交谈: one line to say to someone here, put in the action queue to go out with the next turn. */
function Talk({ person, onDone }: { person: Character; onDone: () => void }) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [line, setLine] = useState('');
  const said = line.trim();
  // the whole of it in sight, its buttons too, even at the foot of a half-open sheet
  useEffect(() => formRef.current?.scrollIntoView?.({ block: 'nearest' }), []);
  const send = (event: FormEvent) => {
    event.preventDefault();
    if (said && queueChip({ kind: 'say', text: said, charId: person.id })) onDone();
  };
  return (
    <form ref={formRef} className={styles.talk} onSubmit={send}>
      <label htmlFor={id}>对{person.name}说</label>
      <input
        id={id}
        className={styles.talkInput}
        value={line}
        maxLength={200}
        autoComplete="off"
        enterKeyHint="send"
        placeholder="写一句话，随下一回合说出"
        onChange={(event) => setLine(event.target.value)}
        // the field opens because the player asked for it: the caret goes there at once
        autoFocus
      />
      <div className={styles.talkActions}>
        <Btn type="submit" variant="solid" disabled={!said}>
          放进行动签
        </Btn>
        <Btn onClick={onDone}>收起</Btn>
      </div>
    </form>
  );
}

function Person({
  saveId,
  person,
  isPlayer,
  here,
  onBack,
  onSaved,
}: {
  saveId: string;
  /** as the list has them now: their look, whether they are here and bonded */
  person: Character;
  isPlayer: boolean;
  /** where the player is: the place of everyone present */
  here: string;
  onBack: () => void;
  onSaved: (recipe: Recipe) => void;
}) {
  const load = useCallback(() => play.person(saveId, person.id), [saveId, person.id]);
  const detail = useRead<PersonDetail>(load, null);
  const [making, setMaking] = useState(false);
  const [talking, setTalking] = useState(false);
  const { run, blocked, busy } = usePanelAction(saveId);
  const fresh = { portrait: person.portrait, present: person.present, bonded: person.bonded };
  const shown: Character = detail.data ? { ...detail.data, ...fresh } : person;
  const beast = useBeastFace(shown);
  // the old page's list: the people here and the bonded ones; a bond is marked on them, not on the player
  const canBond = !isPlayer && (shown.present || shown.bonded === true);
  const toggleBond = () =>
    void run(
      (version) => (shown.bonded ? actions.unbond : actions.bond)(saveId, version, person.id),
      shown.bonded ? `已取消 ${shown.name} 的羁绊` : `已将 ${shown.name} 标记为羁绊`,
    );
  const deeds = [...(detail.data?.deeds ?? [])].reverse();
  const story = detail.data?.biography ?? detail.data?.background;

  return (
    <article className={styles.person} aria-labelledby={`person-${person.id}`}>
      <Btn className={styles.back} onClick={onBack}>
        ‹ 名单
      </Btn>
      <header className={styles.top}>
        <div className={styles.figure} data-beast={beast ? '' : undefined}>
          {beast ? (
            <img src={beast} alt={`${shown.name}的图鉴像`} />
          ) : (
            <Figure recipe={shown.portrait} crop="half" label={`${shown.name}的半身像`} />
          )}
        </div>
        <div className={styles.plate}>
          <h3 id={`person-${person.id}`} className={styles.name}>
            {shown.name}
          </h3>
          {shown.role && <span className={styles.role}>{shown.role}</span>}
          {shown.relation && <Seal glyph={shown.relation} small />}
          {shown.bonded && <span className={styles.bondPlate}>羁绊</span>}
        </div>
      </header>
      <KV
        items={[
          { label: '境界', value: shown.realm },
          { label: '身份', value: shown.role ?? '不详' },
          { label: '所在', value: shown.present ? here : '不在身边' },
          {
            label: '关系',
            value: shown.relation ?? '无',
            ...(shown.affection !== undefined ? { delta: `好感 ${shown.affection}` } : {}),
          },
        ]}
      />
      <div className={styles.actions}>
        {!isPlayer && shown.present && (
          <Btn aria-expanded={talking} onClick={() => setTalking(!talking)}>
            交谈
          </Btn>
        )}
        {canBond && (
          <Btn onClick={toggleBond} disabled={blocked}>
            {shown.bonded ? '取消羁绊' : '标记羁绊'}
          </Btn>
        )}
        {/* the portrait maker draws people; a beast keeps its bestiary picture */}
        {!beast && <Btn onClick={() => setMaking(true)}>改形象</Btn>}
      </div>
      {/* why the bond waits, as every other panel says it (the documents pass, #18) */}
      {canBond && busy && <p className={common.note}>这一回合写完之后才能{shown.bonded ? '取消羁绊' : '标记羁绊'}。</p>}
      {talking && <Talk person={shown} onDone={() => setTalking(false)} />}
      <section className={common.section}>
        <Sub>事迹</Sub>
        {detail.error && !detail.data ? (
          <div className={styles.failed} role="alert">
            <p>{detail.error.message}</p>
            <Btn onClick={detail.retry}>重试</Btn>
          </div>
        ) : !detail.data ? (
          <Loading text="翻检中……" />
        ) : deeds.length === 0 ? (
          <p className={common.note}>尚无可记的事迹。</p>
        ) : (
          <ol className={styles.deeds}>
            {deeds.map((deed, index) => (
              <li key={`${deed.at}-${index}`}>
                <span className={styles.when}>{deed.at}</span>
                <p>{deed.text}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
      {story && (
        <section className={common.section}>
          <Sub>{detail.data?.biography ? '传记' : '来历'}</Sub>
          {story
            .split(/\n+/)
            .filter(Boolean)
            .map((paragraph, index) => (
              <p key={index} className={styles.story}>
                {paragraph}
              </p>
            ))}
        </section>
      )}
      {making && (
        <Maker
          saveId={saveId}
          person={shown}
          onClose={() => setMaking(false)}
          onSaved={(recipe) => {
            setMaking(false);
            onSaved(recipe);
          }}
        />
      )}
    </article>
  );
}

export function People({ saveId }: { saveId: string }) {
  const aim = useAim('people');
  const [tab, setTab] = useState<Tab>(isTab(aim?.tab) ? aim.tab : 'present');
  const [picked, setPicked] = useState<string | null>(aim?.pick ?? null);
  const view = useStateStore((s) => s.view);
  const paneId = useId();
  const load = useCallback(() => play.people(saveId), [saveId]);
  const [looks, setLooks] = useState<Record<string, Recipe>>({});
  // read again whenever the save moves on (a turn ends while the panel is open)
  const people = useRead<PeopleView>(load, view?.version);

  const withLooks = (person: Character): Character => (looks[person.id] ? { ...person, portrait: looks[person.id]! } : person);
  const player = view ? withLooks(playerAsPerson(view)) : null;
  const present = (people.data?.present ?? []).map(withLooks);
  const known = (people.data?.known ?? []).map(withLooks);
  const shownList: Character[] =
    tab === 'present' ? [...(player ? [player] : []), ...present] : tab === 'known' ? known : [...(player ? [player] : []), ...present, ...known];
  const everyone = [...(player ? [player] : []), ...present, ...known];
  const person = picked ? everyone.find((p) => p.id === picked) : undefined;

  const saved = (person: Character, recipe: Recipe) => {
    setLooks((before) => ({ ...before, [person.id]: recipe }));
    const current = useStateStore.getState().view;
    if (current) useStateStore.getState().set(withLook(current, person.id, recipe));
    // someone the view does not list (not here) is drawn from what the play screen asked for
    lookChanged(saveId, person.id, person.name, recipe);
  };

  if (person) {
    return (
      <Person
        key={person.id}
        saveId={saveId}
        person={person}
        isPlayer={person.id === view?.player.id}
        here={view?.place.text ?? ''}
        onBack={() => setPicked(null)}
        onSaved={(recipe) => saved(person, recipe)}
      />
    );
  }

  const label = TABS.find((t) => t.id === tab)?.label ?? '';
  return (
    <>
      <div className={common.tabsRow}>
        <Tabs label="人物" items={TABS} value={tab} controls={paneId} onChange={(id) => isTab(id) && setTab(id)} />
      </div>
      <div id={paneId} className={common.pane} role="tabpanel" aria-label={label}>
        {people.error && !people.data ? (
          <div className={styles.failed} role="alert">
            <p>{people.error.message}</p>
            <Btn onClick={people.retry}>重试</Btn>
          </div>
        ) : !people.data ? (
          <Loading text="翻检中……" />
        ) : shownList.length === 0 ? (
          <Empty title={tab === 'known' ? '尚无相识' : '四下无人'} text={tab === 'known' ? '结识的人会记在这里。' : '此处只有你一人。'} />
        ) : (
          <ul className={common.list}>
            {shownList.map((p) => (
              <li key={p.id}>
                <PersonEntry person={p} onOpen={() => setPicked(p.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
