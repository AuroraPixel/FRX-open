// 行囊 (plan item 41; spec 七, 行囊): the spirit stones, the bag by kind, and what can be done with a
// picked item. Equipping takes effect at once (a panel action); using, giving and throwing away
// touch the story, so they become chips in the action queue and go out with the next turn. As on the
// old page, an important item (要物) is never given away, and throwing one away is asked twice: the
// whole stack leaves the bag when the turn starts.
import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { actions, parseSlot } from '../../api/actions';
import type { Character, Item } from '../../contracts';
import { useQueueStore } from '../../store/queue';
import { useStateStore } from '../../store/state';
import { useUiStore } from '../../store/ui';
import { Btn } from '../../ui/Btn';
import { Detail } from '../../ui/Detail';
import { Dialog } from '../../ui/Dialog';
import { Empty, Loading } from '../../ui/Loading';
import { GRADE_NAMES, Slot, SlotGrid } from '../../ui/Slot';
import { Tabs } from '../../ui/Tabs';
import { Tool } from '../../ui/Tool';
import { GearLife } from './GearLife';
import { queueChip, usePanelAction } from './act';
import { useAim } from './aim';
import { iconUrl, useArt } from './art';
import { useReveal } from './reveal';
import { useRoving } from './roving';
import { BAG_TABS, type BagTab, EQUIP_ROWS, TYPE_LABEL, kindOfType } from './labels';
import common from './common.module.css';
import styles from './Bag.module.css';

type Order = 'given' | 'grade';

function isTab(value: string | undefined): value is BagTab {
  return BAG_TABS.some((tab) => tab.id === value);
}

/** Uses one more of an item: its chip counts up, never past what the bag holds (the old page's addAction). */
function queueUse(item: Item): void {
  const waiting = useQueueStore.getState().items.find((chip) => chip.kind === 'use' && chip.itemId === item.id);
  const quantity = (waiting?.quantity ?? 0) + 1;
  if (quantity > item.quantity) {
    useUiStore.getState().notify(`${item.name}只有 ${item.quantity} 份，都已放进行动签。`);
    return;
  }
  queueChip({
    kind: 'use',
    text: `用 · ${item.name}${quantity > 1 ? ` ×${quantity}` : ''}`,
    itemId: item.id,
    quantity,
  });
}

/** The old page's gift picker leaves out the important items (app.js 38878). */
function giftable(item: Item): boolean {
  return item.type !== '重要物品';
}

function throwAway(item: Item): void {
  queueChip({ kind: 'discard', text: `弃 · ${item.name}`, itemId: item.id });
}

function giveTo(item: Item, person: Character): void {
  queueChip({
    kind: 'gift',
    text: `赠 · ${item.name} → ${person.name}`,
    itemId: item.id,
    charId: person.id,
    quantity: 1,
  });
}

export function Bag({ saveId }: { saveId: string }) {
  const view = useStateStore((s) => s.view);
  const aim = useAim('bag');
  const [tab, setTab] = useState<BagTab>(isTab(aim?.tab) ? aim.tab : 'all');
  const [picked, setPicked] = useState<string | null>(aim?.pick ?? null);
  const [order, setOrder] = useState<Order>('given');
  const [giving, setGiving] = useState(false);
  // the item asked about before it is thrown away
  const [dropping, setDropping] = useState<Item | null>(null);
  // the equipment slot the player came from, when an empty slot of the character panel sent them here
  const [slot, setSlot] = useState(aim?.slot);
  const { run, blocked, busy } = usePanelAction(saveId);
  const paneId = useId();
  const tabsRef = useRef<HTMLDivElement>(null);
  const { icons } = useArt();
  const detailRef = useReveal<HTMLDivElement>(picked);

  const shown = (view?.bag ?? []).filter((item) => tab === 'all' || item.type === tab);
  if (order === 'grade') shown.sort((a, b) => b.grade - a.grade);
  const roving = useRoving(
    shown.map((thing) => thing.id),
    picked,
  );

  if (!view) return <Loading text="载入中……" />;
  const people = view.people.filter((person) => person.present);
  const item = view.bag.find((thing) => thing.id === picked) ?? null;
  const equipReason = item ? view.play?.gear?.pieces[item.id]?.unusable : undefined;
  const pill = item ? view.play?.pills?.find((each) => each.itemId === item.id) : undefined;
  const tabLabel = BAG_TABS.find((t) => t.id === tab)?.label ?? '全部';
  const target = parseSlot(slot);
  const targetRow = target && EQUIP_ROWS.find((row) => row.kind === target.kind);

  const choose = (id: string) => {
    setPicked(picked === id ? null : id);
    setGiving(false);
  };
  const changeTab = (id: string) => {
    if (!isTab(id)) return;
    setTab(id);
    if (item && id !== 'all' && item.type !== id) setPicked(null);
  };
  const equip = async (thing: Item) => {
    const into = target && target.kind === kindOfType(thing.type) ? slot : undefined;
    const done = await run((version) => actions.equip(saveId, version, thing.id, into), `已装备 ${thing.name}`);
    if (done) {
      setPicked(null);
      // the slot asked for is filled now; the next thing goes to the first free one
      if (into) setSlot(undefined);
      tabsRef.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
    }
  };
  const tidy = () => run((version) => actions.tidy(saveId, version), '储物袋已整理');

  return (
    <>
      <div className={styles.stones}>
        <span>下品灵石</span>
        <b>{view.player.stones}</b>
      </div>

      <div className={styles.bar} ref={tabsRef}>
        <Tabs
          className={styles.tabs}
          label="行囊分类"
          items={BAG_TABS}
          value={tab}
          onChange={changeTab}
          controls={paneId}
        />
        <span className={styles.tools}>
          <Tool
            glyph="序"
            label={order === 'grade' ? '按原来的次序' : '按品质排列'}
            aria-pressed={order === 'grade'}
            onClick={() => setOrder(order === 'grade' ? 'given' : 'grade')}
            disabled={view.bag.length < 2}
          />
          <Tool glyph="整" label="整理储物袋" onClick={() => void tidy()} disabled={blocked || view.bag.length < 2} />
        </span>
      </div>

      <div id={paneId} className={common.pane} role="tabpanel" aria-label={tabLabel}>
        {targetRow && target && (
          <p className={common.note}>
            挑一件{targetRow.label}，装进{targetRow.label}第 {target.index + 1} 格。
          </p>
        )}
        {view.bag.length === 0 ? (
          <Empty title="行囊空空" text="得到的东西会收在这里。" />
        ) : shown.length === 0 ? (
          <Empty title="此类无物" text={`储物袋里没有${tabLabel}。`} />
        ) : (
          <SlotGrid {...roving.group}>
            {shown.map((thing) => (
              <Slot
                key={thing.id}
                {...roving.item(thing.id)}
                className={styles.slot}
                data-item={thing.id}
                thing={{
                  name: thing.name,
                  grade: thing.grade,
                  // a count of one goes without saying
                  quantity: thing.quantity > 1 ? thing.quantity : undefined,
                  icon: iconUrl(icons, thing),
                }}
                selected={picked === thing.id}
                onClick={() => choose(thing.id)}
              />
            ))}
          </SlotGrid>
        )}
        {busy && <p className={common.note}>这一回合写完之后才能换装、整理。</p>}
      </div>

      {item && (
        <div ref={detailRef} className={common.revealed}>
          <Detail
            title={item.name}
            meta={`${TYPE_LABEL[item.type]} · ${GRADE_NAMES[item.grade]} · 持有 ${item.quantity}`}
            actions={
              <>
                {item.equippable && (
                  <Btn onClick={() => void equip(item)} disabled={blocked || Boolean(equipReason)}>
                    装备
                  </Btn>
                )}
                {item.usable && <Btn onClick={() => queueUse(item)}>使用</Btn>}
                {giftable(item) && (
                  <Btn onClick={() => setGiving(!giving)} aria-expanded={giving} disabled={people.length === 0}>
                    赠予
                  </Btn>
                )}
                <Btn onClick={() => setDropping(item)}>丢弃</Btn>
                {giving && giftable(item) && (
                  <div className={styles.gift} role="group" aria-label={`把${item.name}赠给谁`}>
                    <span className={styles.giftLabel}>赠给</span>
                    {people.map((person) => (
                      <Btn
                        key={person.id}
                        onClick={() => {
                          giveTo(item, person);
                          setGiving(false);
                        }}
                      >
                        {person.name}
                      </Btn>
                    ))}
                  </div>
                )}
              </>
            }
          >
            <p>{item.text}</p>
            {item.effect && (
              <p className={styles.effect}>
                <span>效果</span>
                {item.effect}
              </p>
            )}
            {/* the cultivation life (gameplay plan items 33, 34): a piece's marks, 祭炼 and 修补 */}
            <GearLife saveId={saveId} itemId={item.id} gear={view?.play?.gear} />
            {/* the cultivation life (gameplay plan item 44): what 耐药 leaves of a cultivation pill */}
            {pill && (
              <p className={styles.effect} data-spent={pill.left === 0 ? '' : undefined}>
                <span>耐药</span>
                {pill.text}
              </p>
            )}
            {!giftable(item) ? (
              <p className={styles.aside}>要物，不能赠人。</p>
            ) : (
              people.length === 0 && <p className={styles.aside}>身边没有人，无从赠予。</p>
            )}
          </Detail>
        </div>
      )}
      {/* over the whole screen: the panel's frame would hold a fixed layer inside itself */}
      {createPortal(
        <Dialog
          open={dropping !== null}
          title="丢弃"
          confirmLabel="丢弃"
          danger
          onConfirm={() => {
            if (dropping) throwAway(dropping);
            setDropping(null);
          }}
          onCancel={() => setDropping(null)}
        >
          {dropping && (
            <p>
              把{dropping.name}
              {dropping.quantity > 1 ? `（${dropping.quantity} 份）全部` : ''}丢掉？下一回合开始时从储物袋里拿走，找不回来。
            </p>
          )}
        </Dialog>,
        document.body,
      )}
    </>
  );
}
