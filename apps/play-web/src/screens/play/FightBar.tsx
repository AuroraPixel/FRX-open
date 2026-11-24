// A fight's commands (斗法的指令, gameplay plan item 21; the mock-up's .fx-cmds, .fx-cmd, .fx-belt, .fx-slot,
// .fx-cap): six diamonds in a row (攻 术 物 御 遁 察, and 和 when the foe will listen, 破 while the foes' array
// stands), each with a line of small words; the one to use now gilded, one spent this fight dashed, one that
// cannot be used faded. Over them the arrays of both sides when there are any (item 43).
// Under them the belt, five slots of what 物 can use. 术 and 物 open a small sheet to pick a skill (its
// cost and chance) or a thing from the belt (its count); the rest go at once as move { command }.
// Phones put the bar in the bottom bar, with the panels' 卷 at the belt's end; desktops at the book's foot,
// with a line of words under the belt.
// Over the commands, the cultivation life's spirit beast (item 41): the one out with the player (its picture,
// name, temperament, whether it heeds orders, its 气血) and its three orders, one of which rides with the next
// move (move.order); and 驯 (move tame) while a beast foe is worn down enough, with its odds.
import { useEffect, useRef, useState } from 'react';
import type { FightBeast, FightCommand, FightOrder, FightTame, Move, PlayFight } from '../../contracts';
import { chineseNumber } from '../../lib/numerals';
import { useUiStore } from '../../store/ui';
import { Gem } from '../../ui/Gem';
import { Sheet } from '../../ui/Sheet';
import { beastPicture, iconUrl, useArt } from '../sheets/art';
import { FightArrays } from './FightArrays';
import styles from './FightBar.module.css';

export interface FightSkillChoice {
  skillId: string;
  name: string;
  /** 「耗法力八」, 「法力 8」 */
  cost?: string;
  /** the chance to hit, 0 to 100 */
  odds?: number;
  off?: boolean;
  note?: string;
}

export interface FightBarProps {
  fight: PlayFight;
  /** what 术 can cast: the fight's own list, else the save's skills */
  skills: FightSkillChoice[];
  onMove: (move: Move) => void;
  /** a turn is being written: nothing can be pressed */
  disabled?: boolean;
  /** phones: the panels' 卷 at the belt's end */
  onPanels?: () => void;
  panelsOpen?: boolean;
  /** desktops: a line of words under the belt */
  caption?: boolean;
  /** spread over the width (the phone's bar) */
  spread?: boolean;
  /** the species of the beast out (play.beasts), for its picture */
  beastSpecies?: string;
}

const BELT_SLOTS = 5;

const tenths = (odds: number) => (odds < 5 ? '不足一成' : `${Math.round(odds / 10) === 2 ? '两' : chineseNumber(Math.min(10, Math.round(odds / 10)))}成`);

/** What a screen reader hears for a command: its glyph, its line, and why it cannot be used (unless the line says it). */
export function commandLabel(command: FightCommand): string {
  const state = command.used ? '已用过' : command.off ? '眼下用不了' : command.hint ? '宜用' : '';
  return state && !command.note.includes(state) ? `${command.glyph}：${command.note}，${state}` : `${command.glyph}：${command.note}`;
}

/** 「火弹符二、回气丹一、阵旗一。」 and, when one command is the one to use, why. */
export function captionOf(fight: PlayFight): string {
  const belt = fight.belt.map((item) => `${item.name}${item.quantity === 2 ? '两' : chineseNumber(item.quantity)}`).join('、');
  const hint = fight.commands.find((command) => command.hint);
  const foe = fight.foes.find((each) => each.intent);
  return [
    belt ? `腰带上${belt}。` : '腰带上没有能用的。',
    hint && foe ? `${foe.name}在${foe.intent}，这一手宜${hint.glyph}。` : '',
  ].join('');
}

/** What a screen reader hears for an order: 「令灵猫扑击：抢在前头扑上去」, and whether it is the one given. */
export function orderLabel(beast: FightBeast, order: FightOrder): string {
  return `令${beast.name}${order.label}：${order.note}`;
}

/** What a screen reader hears for 驯: the foe, the odds or why it cannot be tried. */
export function tameLabel(tame: FightTame): string {
  return `驯：${tame.name}，${tame.note}${tame.off ? '，眼下用不了' : ''}`;
}

function BeastRow({
  beast,
  tame,
  species,
  order,
  onOrder,
  onTame,
  disabled,
}: {
  beast?: FightBeast;
  tame?: FightTame;
  species?: string;
  order: FightOrder['order'] | null;
  onOrder: (order: FightOrder) => void;
  onTame: () => void;
  disabled: boolean;
}) {
  const { bestiary } = useArt();
  const picture = beast ? beastPicture(bestiary, species ?? '') : null;
  return (
    <div className={styles.beastRow} data-tame-only={!beast ? '' : undefined}>
      {beast && picture && (
        <>
          <span className={styles.beastPic} data-known={picture.known ? '' : undefined} aria-hidden="true">
            <img src={picture.url} alt="" />
          </span>
          <span className={styles.beastWords} role="img" aria-label={`灵兽${beast.name}，${beast.temperament}，${beast.heeds ? '听令' : '不听令'}，气血 ${beast.hp.current} / ${beast.hp.max}`}>
            <b>{beast.name}</b>
            <span>
              {beast.temperament} · {beast.heeds ? '听令' : '不听令'}
            </span>
            <i className={styles.beastHp} style={{ width: `${beast.hp.max ? Math.round((100 * beast.hp.current) / beast.hp.max) : 0}%` }} />
          </span>
          <div className={styles.orders} role="group" aria-label={`给${beast.name}下令`}>
            {beast.orders.map((each) => (
              <button
                key={each.order}
                type="button"
                className={styles.order}
                aria-label={orderLabel(beast, each)}
                aria-pressed={order === each.order}
                aria-disabled={each.off || undefined}
                data-off={each.off ? '' : undefined}
                disabled={disabled}
                onClick={() => onOrder(each)}
              >
                <span aria-hidden="true">{each.glyph}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {tame && (
        <button
          type="button"
          className={styles.tame}
          aria-label={tameLabel(tame)}
          aria-disabled={tame.off || undefined}
          data-off={tame.off ? '' : undefined}
          disabled={disabled}
          onClick={onTame}
        >
          <span className={styles.d} aria-hidden="true">
            <span>{tame.glyph}</span>
          </span>
          {!beast && (
            <em aria-hidden="true">
              驯 {tame.name} · {tame.note}
            </em>
          )}
          {beast && <em aria-hidden="true">{tame.note}</em>}
        </button>
      )}
    </div>
  );
}

export function FightBar({ fight, skills, onMove, disabled = false, onPanels, panelsOpen = false, caption = false, spread = false, beastSpecies }: FightBarProps) {
  const [picking, setPicking] = useState<'skill' | 'item' | null>(null);
  // the order the beast out takes with the next move, if any
  const [order, setOrder] = useState<FightOrder['order'] | null>(null);
  const notify = useUiStore((s) => s.notify);
  const { icons } = useArt();
  const beast = fight.beast;

  const send = (move: Move) => {
    onMove(order && beast ? { ...move, order } : move);
    setOrder(null);
  };
  const press = (command: FightCommand) => {
    if (disabled) return;
    if (command.off || command.used) {
      notify(`${command.glyph}：${command.note}`);
      return;
    }
    if (command.command === 'skill') setPicking('skill');
    else if (command.command === 'item') setPicking('item');
    else send({ command: command.command });
  };
  const choose = (move: Move) => {
    setPicking(null);
    send(move);
  };
  const giveOrder = (each: FightOrder) => {
    if (disabled || !beast) return;
    if (each.off) {
      notify(`${beast.name}：${each.note}`);
      return;
    }
    // the order given shows gilded until the next move takes it (no toast over the commands)
    setOrder(order === each.order ? null : each.order);
  };
  const tame = () => {
    if (disabled || !fight.tame) return;
    if (fight.tame.off) {
      notify(`驯：${fight.tame.note}`);
      return;
    }
    send({ command: 'tame', targetId: fight.tame.foeId });
  };
  const slots = Array.from({ length: Math.max(BELT_SLOTS, Math.min(fight.belt.length, BELT_SLOTS)) }, (_, at) => fight.belt[at] ?? null);
  // seven or eight commands too many for the bar scroll sideways: the row says whether it is scrolled from its
  // start and whether it is at its end, for its fades (FightBar.module.css)
  const commandsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = commandsRef.current;
    if (!row) return undefined;
    const mark = () => {
      row.toggleAttribute('data-scrolled', row.scrollLeft > 1);
      row.toggleAttribute('data-end', row.scrollLeft + row.clientWidth >= row.scrollWidth - 1);
    };
    mark();
    row.addEventListener('scroll', mark, { passive: true });
    const sized = typeof ResizeObserver === 'function' ? new ResizeObserver(mark) : null;
    sized?.observe(row);
    return () => {
      row.removeEventListener('scroll', mark);
      sized?.disconnect();
    };
  }, [fight.commands.length]);

  return (
    <div className={styles.bar} data-spread={spread ? '' : undefined}>
      {/* the arrays of both sides (item 43), over the commands */}
      {fight.arrays && fight.arrays.length > 0 && <FightArrays arrays={fight.arrays} />}
      {(beast || fight.tame) && (
        <BeastRow beast={beast} tame={fight.tame} species={beastSpecies} order={order} onOrder={giveOrder} onTame={tame} disabled={disabled || picking !== null} />
      )}
      {/* while a picker is open the commands wait (a desktop's side panel leaves some of them uncovered) */}
      <div
        ref={commandsRef}
        className={styles.commands}
        role="group"
        aria-label={`斗法 · 第${chineseNumber(fight.round)}回合`}
        data-count={fight.commands.length}
        inert={picking !== null || undefined}
      >
        {fight.commands.map((command) => (
          <button
            key={command.command}
            type="button"
            className={styles.command}
            data-hint={command.hint && !command.used && !command.off ? '' : undefined}
            data-used={command.used ? '' : undefined}
            data-off={command.off ? '' : undefined}
            aria-label={commandLabel(command)}
            aria-disabled={command.used || command.off || undefined}
            disabled={disabled}
            onClick={() => press(command)}
          >
            <span className={styles.d} aria-hidden="true">
              <span>{command.glyph}</span>
            </span>
            <em aria-hidden="true">{command.note}</em>
          </button>
        ))}
      </div>
      <div className={styles.beltRow}>
        <div className={styles.belt} role="img" aria-label={`腰带：${fight.belt.map((item) => `${item.name}${item.quantity}`).join('、') || '空的'}`}>
          <b aria-hidden="true">腰带</b>
          {slots.map((item, at) =>
            item ? (
              <span key={item.itemId} className={styles.slot} aria-hidden="true">
                {iconUrl(icons, { icon: item.icon, type: '消耗品' }) ? (
                  <img src={iconUrl(icons, { icon: item.icon, type: '消耗品' })} alt="" />
                ) : (
                  <i>{item.name.slice(-1)}</i>
                )}
                {item.quantity > 1 && <u>{item.quantity}</u>}
              </span>
            ) : (
              <span key={`empty-${at}`} className={styles.slot} data-empty="" aria-hidden="true" />
            ),
          )}
        </div>
        {onPanels && <Gem glyph="卷" label="导航" labelMode="none" selected={panelsOpen} onClick={onPanels} className={styles.panels} />}
      </div>
      {caption && <p className={styles.caption}>{captionOf(fight)}</p>}
      {picking === 'skill' && (
        <Sheet title="施术" open fit onClose={() => setPicking(null)} className={styles.picker}>
          <ul className={styles.choices}>
            {skills.length === 0 && <li className={styles.none}>无术可施。</li>}
            {skills.map((skill) => (
              <li key={skill.skillId}>
                <button
                  type="button"
                  className={styles.choice}
                  aria-disabled={skill.off || undefined}
                  onClick={() => (skill.off ? notify(`${skill.name}：${skill.note ?? '眼下施不了'}`) : choose({ command: 'skill', skillId: skill.skillId }))}
                >
                  <b>{skill.name}</b>
                  <span>{[skill.cost, skill.odds !== undefined ? `命中${tenths(skill.odds)}` : '', skill.off ? skill.note : ''].filter(Boolean).join(' · ')}</span>
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
      {picking === 'item' && (
        <Sheet title="用物" open fit onClose={() => setPicking(null)} className={styles.picker}>
          <ul className={styles.choices}>
            {fight.belt.length === 0 && <li className={styles.none}>腰带上没有能用的。</li>}
            {fight.belt.map((item) => (
              <li key={item.itemId}>
                <button type="button" className={styles.choice} onClick={() => choose({ command: 'item', itemId: item.itemId })}>
                  {iconUrl(icons, { icon: item.icon, type: '消耗品' }) && <img src={iconUrl(icons, { icon: item.icon, type: '消耗品' })} alt="" />}
                  <b>{item.name}</b>
                  <span>余 {item.quantity}</span>
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
    </div>
  );
}
