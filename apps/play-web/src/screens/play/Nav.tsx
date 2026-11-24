// The way to the panels (spec 四, 导航; 十一, 导航). Desktops: a row of diamonds at the bottom right,
// 卷轴 角色 行囊 任务 地图 更多, where 更多 opens a second row. Phones: 卷 in the bottom bar opens a
// four-column grid of every panel.
import { useState } from 'react';
import type { SheetName } from '../../store/ui';
import { Gem } from '../../ui/Gem';
import type { IconName } from '../../ui/Icon';
import styles from './Nav.module.css';

export type PanelName = Exclude<SheetName, 'nav'>;

/** Every panel with its two-character name and icon, in the spec's order (八, 按钮的字). */
export const PANELS: readonly { name: PanelName; label: string; icon: IconName; key?: string; life?: boolean }[] = [
  { name: 'character', label: '角色', icon: 'person', key: 'c' },
  { name: 'bag', label: '行囊', icon: 'bag', key: 'b' },
  { name: 'skills', label: '技能', icon: 'skill' },
  { name: 'quests', label: '任务', icon: 'flag', key: 'q' },
  { name: 'people', label: '人物', icon: 'people' },
  { name: 'beasts', label: '灵兽', icon: 'beast' },
  { name: 'world', label: '世界', icon: 'world' },
  // the cultivation life's own (gameplay plan items 45 and 43; 46 and 49): a save of the novel has none
  { name: 'home', label: '洞府', icon: 'home', life: true },
  { name: 'arrays', label: '阵法', icon: 'array', life: true },
  { name: 'sect', label: '宗门', icon: 'sect', life: true },
  { name: 'life', label: '一生', icon: 'life', life: true },
  { name: 'map', label: '地图', icon: 'map', key: 'm' },
  { name: 'saves', label: '存档', icon: 'save' },
  { name: 'settings', label: '设置', icon: 'settings' },
];

const RAIL: readonly PanelName[] = ['character', 'bag', 'quests', 'map'];
const MORE: readonly PanelName[] = ['skills', 'people', 'beasts', 'world', 'home', 'arrays', 'sect', 'life', 'saves', 'settings'];

/** The panels a save shows: the life's own only in a save of the cultivation life. */
const shownFor = (life: boolean) => (name: PanelName) => life || !PANELS.find((p) => p.name === name)?.life;

const panel = (name: PanelName) => PANELS.find((p) => p.name === name)!;

export interface RailProps {
  open: SheetName | null;
  onOpen: (name: PanelName) => void;
  /** 卷轴: back to the story */
  onBook: () => void;
  /** a save of the cultivation life: its own panels (洞府, 阵法, 宗门, 一生) are in 更多 too */
  life?: boolean;
}

/** The desktop row of diamonds; 更多 shows the other six above it (ten in a save of the cultivation life). */
export function Rail({ open, onOpen, onBook, life = false }: RailProps) {
  const [more, setMore] = useState(false);
  const extra = MORE.filter(shownFor(life));
  const moreOpen = more || (open !== null && (MORE as readonly string[]).includes(open));
  const pick = (name: PanelName) => {
    onOpen(name);
    if (!(MORE as readonly string[]).includes(name)) setMore(false);
  };
  return (
    <nav className={styles.rail} aria-label="导航">
      {moreOpen && (
        <div className={`${styles.row} ${styles.more}`} id="nav-more">
          {extra.map((name) => (
            <Gem key={name} icon={panel(name).icon} label={panel(name).label} selected={open === name} onClick={() => pick(name)} />
          ))}
        </div>
      )}
      <div className={styles.row}>
        <Gem icon="scroll" label="卷轴" selected={open === null} onClick={onBook} />
        {RAIL.map((name) => (
          <Gem key={name} icon={panel(name).icon} label={panel(name).label} selected={open === name} onClick={() => pick(name)} />
        ))}
        <Gem
          icon="more"
          label="更多"
          selected={moreOpen}
          aria-expanded={moreOpen}
          aria-controls="nav-more"
          onClick={() => setMore(!moreOpen)}
        />
      </div>
    </nav>
  );
}

/** The phone's navigation grid: four columns, a diamond and two characters each. */
export function NavGrid({ open, onOpen, life = false }: { open: SheetName | null; onOpen: (name: PanelName) => void; life?: boolean }) {
  return (
    <div className={styles.grid}>
      {PANELS.filter((p) => shownFor(life)(p.name)).map((p) => (
        <Gem key={p.name} icon={p.icon} label={p.label} labelMode="below" selected={open === p.name} onClick={() => onOpen(p.name)} />
      ))}
    </div>
  );
}
