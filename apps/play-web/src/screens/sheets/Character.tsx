// 角色 (plan item 40; spec 七, 角色): who the player is, the eleven attributes with the totals the
// server worked out, the four rows of six equipment slots, traits, and the way to the next realm.
// Taking gear off is a panel action that answers with the new state, so every total moves at once.
import { type ReactNode, useId, useRef, useState } from 'react';
import { type EquipKind, actions, parseSlot, slotName } from '../../api/actions';
import type { Attribute, IconManifest, Item, Player, PlayMind, StateView } from '../../contracts';
import { useStateStore } from '../../store/state';
import { useUiStore } from '../../store/ui';
import { Act } from '../../ui/Act';
import { Bar } from '../../ui/Bar';
import { Btn } from '../../ui/Btn';
import { Detail } from '../../ui/Detail';
import { Entry } from '../../ui/Entry';
import { KV } from '../../ui/KV';
import { Toxin } from '../../ui/Toxin';
import { Loading } from '../../ui/Loading';
import { GRADE_NAMES, Slot } from '../../ui/Slot';
import { Sub } from '../../ui/Sub';
import { Belt, GearLife } from './GearLife';
import { queueChip, usePanelAction } from './act';
import { aimSheet, useAim } from './aim';
import { iconUrl, useArt } from './art';
import { useReveal } from './reveal';
import { useRoving } from './roving';
import { EQUIP_ROWS, TYPE_LABEL } from './labels';
import { Rows } from './Rows';
import common from './common.module.css';
import styles from './Character.module.css';

/** +5, −2: a bonus with its sign. */
export function signed(value: number): string {
  return value < 0 ? `−${Math.abs(value)}` : `+${value}`;
}


/** The spirit root as the page writes it: the save keeps 「真灵根 土,水」, the page 「真灵根 土、水」 (spec 八, full-width
 * punctuation; the creation's confirmation writes it so too). */
function rootWords(name: string): string {
  return name.replace(/\s*[,，]\s*/g, '、');
}

function Who({ player }: { player: Player }) {
  return (
    <div className={styles.who}>
      <span className={styles.gem} aria-hidden="true">
        <i>{player.realmGlyph}</i>
      </span>
      <div className={styles.whoText}>
        <strong className={styles.name}>{player.name}</strong>
        <span className={styles.line}>
          {player.realm} · {rootWords(player.root.name)}
        </span>
      </div>
    </div>
  );
}

function Basics({ player }: { player: Player }) {
  const root = player.root.name.split(/\s+/)[0] ?? player.root.name;
  return (
    <KV
      items={[
        { label: '境界', value: player.realm },
        { label: '修为', value: `${player.xp.current} / ${player.xp.max}` },
        { label: '寿元', value: `${player.lifespan.age} / ${player.lifespan.max}` },
        { label: '灵根', value: `${root} ×${player.root.multiplier.toFixed(1)}` },
        { label: '功法', value: player.technique?.name ?? '未修' },
        { label: '每日修为', value: player.progress ? `约 ${player.progress.perDay}` : '—' },
      ]}
    />
  );
}

function AttributeMore({ id, attribute }: { id: string; attribute: Attribute }) {
  return (
    <div id={id} className={styles.attrMore}>
      <KV
        items={[
          { label: '当前', value: attribute.base },
          { label: '上限', value: attribute.max ?? '—' },
          { label: '加成', value: attribute.bonus ? signed(attribute.bonus) : '无' },
          { label: '合计', value: attribute.total },
        ]}
      />
      {attribute.sources.length > 0 ? (
        <ul className={styles.sources} aria-label={`${attribute.label}的加成来源`}>
          {attribute.sources.map((source, index) => (
            <li key={`${source.from}-${index}`}>
              <span>{source.from}</span>
              <b>{signed(source.value)}</b>
            </li>
          ))}
        </ul>
      ) : (
        <p className={common.note}>没有加成。</p>
      )}
    </div>
  );
}

/** The eleven attributes, two to a row; a picked one opens under its row with where its bonus comes from. */
function Attributes({ list }: { list: Attribute[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const roving = useRoving(
    list.map((attribute) => attribute.key),
    open,
  );
  const base = useId();
  const cells: ReactNode[] = [];
  list.forEach((attribute, index) => {
    const id = `${base}-${index}`;
    const expanded = open === attribute.key;
    cells.push(
      <button
        key={attribute.key}
        {...roving.item(attribute.key)}
        type="button"
        className={styles.attr}
        aria-expanded={expanded}
        aria-controls={expanded ? id : undefined}
        onClick={() => setOpen(expanded ? null : attribute.key)}
      >
        <span className={styles.attrLabel}>{attribute.label}</span>
        <span className={styles.attrValue}>
          {attribute.total}
          {attribute.bonus !== 0 && <em>{signed(attribute.bonus)}</em>}
        </span>
      </button>,
    );
    // the detail goes after the pair, so the two columns stay in step
    if (index % 2 === 1 || index === list.length - 1) {
      const first = index - (index % 2);
      const shown = list.slice(first, index + 1).find((a) => a.key === open);
      if (shown)
        cells.push(<AttributeMore key={`${shown.key}-more`} id={`${base}-${list.indexOf(shown)}`} attribute={shown} />);
    }
  });
  return (
    <div className={styles.attrs} {...roving.group}>
      {cells}
    </div>
  );
}

interface Picked {
  kind: EquipKind;
  index: number;
  item: Item;
}

/** The four rows of six; the picked slot's detail opens right under its own row. */
function Gear({
  equipment,
  icons,
  picked,
  detail,
  onPick,
  onEmpty,
  idle = {},
}: {
  equipment: StateView['equipment'];
  icons: IconManifest | null;
  /** the cultivation life: the worn pieces that do not count, by bag id, and why */
  idle?: Record<string, string>;
  picked: string | null;
  detail: ReactNode;
  onPick: (kind: EquipKind, index: number) => void;
  onEmpty: (kind: EquipKind, index: number) => void;
}) {
  const pickedKind = parseSlot(picked ?? undefined)?.kind;
  const roving = useRoving(
    EQUIP_ROWS.flatMap(({ kind }) => equipment[kind].map((_, index) => slotName(kind, index))),
    picked,
  );
  return (
    <div className={styles.gearRows} {...roving.group}>
      {EQUIP_ROWS.map(({ kind, label }) => {
        const slots: (Item | null)[] = equipment[kind];
        const names = slots.filter((item): item is Item => item !== null).map((item) => item.name);
        return (
          <div key={kind} className={styles.gearRow} role="group" aria-label={label}>
            <div className={styles.gearHead} aria-hidden="true">
              <span className={styles.gearKind}>{label}</span>
              <span className={styles.gearNames}>{names.length ? names.join('、') : '空着'}</span>
              <span className={styles.gearCount}>{names.length} / 6</span>
            </div>
            <div className={styles.six}>
              {slots.map((item, index) => {
                const slot = slotName(kind, index);
                return (
                  <Slot
                    key={slot}
                    {...roving.item(slot)}
                    className={styles.gear}
                    data-slot={slot}
                    data-idle={item && idle[item.id] ? '' : undefined}
                    thing={item ? { name: item.name, grade: item.grade, icon: iconUrl(icons, item) } : null}
                    selected={item ? picked === slot : undefined}
                    aria-label={
                      item
                        ? `${label}第 ${index + 1} 格：${item.name} · ${item.tier ?? GRADE_NAMES[item.grade]}${idle[item.id] ? `，不算数：${idle[item.id]}` : ''}`
                        : `${label}第 ${index + 1} 格：空着，去行囊挑一件`
                    }
                    onClick={() => (item ? onPick(kind, index) : onEmpty(kind, index))}
                  />
                );
              })}
            </div>
            {pickedKind === kind && detail}
          </div>
        );
      })}
    </div>
  );
}

/** 修行详情: the technique and its layer, how fast cultivation goes, and what the next realm asks. */
function Cultivation({ player }: { player: Player }) {
  const { progress, technique } = player;
  const rows = [
    {
      label: '功法',
      value: technique ? `${technique.name}${technique.layer ? ` · ${technique.layer}` : ''}` : '未修功法',
    },
    {
      label: '修炼效率',
      value: `${progress ? `每日约 ${progress.perDay} · ` : ''}灵根 ×${player.root.multiplier.toFixed(1)}`,
    },
    ...(progress ? [{ label: '下一境界', value: progress.next }] : []),
  ];
  const breakthrough = () => {
    queueChip({ kind: 'other', text: '冲关 · 突破境界' });
    useUiStore.getState().closeSheet();
  };
  return (
    <>
      <Bar label="修为" current={player.xp.current} max={player.xp.max} tone="gold" />
      <Rows rows={rows} />
      {progress?.ready && (
        <Act glyph="破" name="冲关" note="条件已满 · 随下一回合冲击瓶颈" hot onClick={breakthrough} />
      )}
    </>
  );
}

/** The cultivation life's worn pieces that do not count (gear.inactive), by bag id, and why. */
export function idleOf(view: StateView): Record<string, string> {
  return Object.fromEntries((view.play?.gear?.inactive ?? []).map((piece) => [piece.id, piece.reason]));
}

/** What 心境 holds back: the current realm's threshold not reached (cultivating at half speed), the next
 *  gate's not reached (the gate is shut until it is). */
export function mindNotes(mind: PlayMind): string[] {
  const out: string[] = [];
  if (mind.now && !mind.now.met) out.push(`未到${mind.now.realm}的${mind.now.need}：修炼只有一半的快`);
  if (mind.next && !mind.next.met) out.push(`冲${mind.next.realm}要${mind.next.need}，还差${Math.max(0, mind.next.need - mind.value)}`);
  return out;
}

/** 心境 (item 36): the number, the engine's line (「阅历 12 · 筑基要 30」) and what it holds back. */
function Mind({ mind }: { mind: PlayMind }) {
  return (
    <div className={styles.mind}>
      <p className={styles.mindLine}>
        <b>{mind.value}</b>
        <span>{mind.text}</span>
      </p>
      {mindNotes(mind).map((note) => (
        <p key={note} className={styles.mindNote}>
          {note}
        </p>
      ))}
    </div>
  );
}

export function Character({ saveId }: { saveId: string }) {
  const view = useStateStore((s) => s.view);
  const aim = useAim('character');
  const [picked, setPicked] = useState<string | null>(aim?.pick ?? null);
  const { run, blocked, busy } = usePanelAction(saveId);
  const gearRef = useRef<HTMLElement>(null);
  const subIds = useId();
  const { icons } = useArt();
  const detailRef = useReveal<HTMLDivElement>(picked);

  if (!view) return <Loading text="载入中……" />;
  const { player, equipment } = view;

  const at = parseSlot(picked ?? undefined);
  const pickedGear: Picked | null =
    at && equipment[at.kind][at.index] ? { ...at, item: equipment[at.kind][at.index]! } : null;
  const mainTechnique = view.play?.gear?.active.find((piece) => piece.role === 'main')?.id;
  const pickedLabel = pickedGear ? (EQUIP_ROWS.find((row) => row.kind === pickedGear.kind)?.label ?? '') : '';

  const pick = (kind: EquipKind, index: number) => {
    const slot = slotName(kind, index);
    setPicked(picked === slot ? null : slot);
  };
  const fill = (kind: EquipKind, index: number) => {
    const row = EQUIP_ROWS.find((r) => r.kind === kind);
    aimSheet({ sheet: 'bag', tab: row?.type, slot: slotName(kind, index) });
    useUiStore.getState().openSheet('bag');
  };
  const takeOff = async () => {
    if (!pickedGear) return;
    const slot = slotName(pickedGear.kind, pickedGear.index);
    const done = await run(
      (version) => actions.unequip(saveId, version, pickedGear.item.id, slot),
      `已卸下 ${pickedGear.item.name}`,
    );
    if (done) {
      setPicked(null);
      gearRef.current?.querySelector<HTMLButtonElement>(`[data-slot="${slot}"]`)?.focus();
    }
  };

  return (
    <>
      <Who player={player} />

      <section className={common.section} aria-labelledby={`${subIds}-basics`}>
        <Sub id={`${subIds}-basics`}>根基</Sub>
        <Basics player={player} />
      </section>

      <section className={common.section} aria-labelledby={`${subIds}-attrs`}>
        <Sub id={`${subIds}-attrs`}>属性</Sub>
        <Attributes list={player.attributes} />
      </section>

      <section className={common.section} aria-labelledby={`${subIds}-gear`} ref={gearRef}>
        <Sub id={`${subIds}-gear`}>装备</Sub>
        <Gear
          equipment={equipment}
          icons={icons}
          idle={idleOf(view)}
          picked={picked}
          onPick={pick}
          onEmpty={fill}
          detail={
            pickedGear && (
              <div ref={detailRef} className={common.revealed}>
                <Detail
                  title={pickedGear.item.name}
                  meta={`${TYPE_LABEL[pickedGear.item.type]} · ${pickedGear.item.tier ?? GRADE_NAMES[pickedGear.item.grade]} · ${pickedLabel}第 ${pickedGear.index + 1} 格`}
                  actions={
                    <>
                      {view.play && pickedGear.kind === 'technique' && (pickedGear.item.id === mainTechnique
                        ? <span>主修功法</span>
                        : <Btn disabled={blocked || Boolean(view.play.gear?.pieces[pickedGear.item.id]?.unusable)}
                            onClick={() => void run(
                              (version) => actions.primaryTechnique(saveId, version, pickedGear.item.id),
                              `主修「${pickedGear.item.name}」`,
                            )}>设为主修</Btn>)}
                      <Btn onClick={() => void takeOff()} disabled={blocked}>卸下</Btn>
                    </>
                  }
                >
                  <p>{pickedGear.item.text}</p>
                  {pickedGear.item.effect && (
                    <p className={styles.effect}>
                      <span>效果</span>
                      {pickedGear.item.effect}
                    </p>
                  )}
                  {busy && <p className={common.note}>这一回合写完之后才能换装。</p>}
                  {/* the cultivation life (gameplay plan items 33, 34): its marks, 祭炼 and 修补 */}
                  <GearLife saveId={saveId} itemId={pickedGear.item.id} gear={view.play?.gear} />
                </Detail>
              </div>
            )
          }
        />
      </section>

      {/* the cultivation life (gameplay plan item 41): the spirit beasts in a line, opening their panel */}
      {view.play?.beasts && (
        <section className={common.section} aria-labelledby={`${subIds}-beasts`}>
          <Sub id={`${subIds}-beasts`}>灵兽</Sub>
          <button type="button" className={styles.beastsLink} onClick={() => useUiStore.getState().openSheet('beasts')}>
            <b>
              养着 {view.play.beasts.kept} / {view.play.beasts.cap}
            </b>
            <span>
              {view.play.beasts.beasts.find((beast) => beast.id === view.play?.beasts?.out)?.name
                ? `随身出战：${view.play.beasts.beasts.find((beast) => beast.id === view.play?.beasts?.out)?.name}`
                : view.play.beasts.beasts.length
                  ? '没有随身出战的灵兽'
                  : '还没有灵兽'}
            </span>
            <i aria-hidden="true" />
          </button>
        </section>
      )}

      {/* the cultivation life (gameplay plan item 33): what 物 can use in a fight */}
      {view.play?.gear && (
        <section className={common.section} aria-labelledby={`${subIds}-belt`}>
          <Sub id={`${subIds}-belt`}>腰带</Sub>
          <Belt
            belt={view.play.gear.belt}
            bag={view.bag}
            disabled={blocked}
            onSet={(items) => void run((version) => actions.belt(saveId, version, items), '腰带换好了')}
          />
        </section>
      )}

      <section className={common.section} aria-labelledby={`${subIds}-traits`}>
        <Sub id={`${subIds}-traits`}>词条</Sub>
        {player.traits.length ? (
          <ul className={common.list}>
            {player.traits.map((trait) => (
              <li key={trait.name}>
                <Entry title={trait.name} text={trait.text} />
              </li>
            ))}
          </ul>
        ) : (
          <p className={common.note}>尚无词条。机缘所得的词条会记在这里。</p>
        )}
      </section>

      {player.statuses.length > 0 && (
        <section className={common.section} aria-labelledby={`${subIds}-statuses`}>
          <Sub id={`${subIds}-statuses`}>状态</Sub>
          <ul className={common.list}>
            {player.statuses.map((status) => (
              <li key={status.name}>
                <Entry title={status.name} text={status.text} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={common.section} aria-labelledby={`${subIds}-way`}>
        <Sub id={`${subIds}-way`}>修行详情</Sub>
        <Cultivation player={player} />
      </section>

      {/* the cultivation life (gameplay plan item 36): 心境 and its thresholds */}
      {view.play?.mind && (
        <section className={common.section} aria-labelledby={`${subIds}-mind`}>
          <Sub id={`${subIds}-mind`}>心境</Sub>
          <Mind mind={view.play.mind} />
        </section>
      )}

      {/* the cultivation life (gameplay plan item 44): 丹毒 and its three lines */}
      {view.play?.toxin && (
        <section className={common.section} aria-labelledby={`${subIds}-toxin`}>
          <Sub id={`${subIds}-toxin`}>丹毒</Sub>
          <Toxin toxin={view.play.toxin} />
        </section>
      )}
    </>
  );
}
