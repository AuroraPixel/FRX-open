// The panels (plan items 40–47, 49, 51), by the name the interface store opens them with. The play
// screen shows the one open inside its Sheet, under this title; each reads the state view from the
// store and takes the save's id for the actions and reads it makes. The heavy ones (the map with its
// ink, the settings with the licences, the saves) bring their code when first opened: the play screen
// loads without them.
import { type ComponentType, lazy } from 'react';
import type { SheetName } from '../../store/ui';
import { Bag } from './Bag';
import { Beasts } from './Beasts';
import { Character } from './Character';
import { CalendarSheet } from './Calendar';
import { ContentsSheet } from './Contents';
import { CultivateSheet, RestSheet, WaitSheet } from './Cultivate';
import { GatePanel } from './Gate';
import { NoticesSheet } from './Notices';
import { People } from './People';
import { Quests } from './Quests';
import { CraftSheet } from './Craft';
import { ArraysSheet } from './Arrays';
import { HomeSheet } from './Home';
import { LegacySheet } from './Legacy';
import { LifeSheet } from './Life';
import { SectSheet } from './Sect';
import { ThreadSheet } from './Thread';
import { ShopSheet } from './Shop';
import { Skills } from './Skills';
import { World } from './World';

const MapSheet = lazy(() => import('./Map').then((module) => ({ default: module.MapSheet })));
const SavesSheet = lazy(() => import('../saves/SavesSheet').then((module) => ({ default: module.SavesSheet })));
const Settings = lazy(() => import('./Settings').then((module) => ({ default: module.Settings })));

export interface SheetEntry {
  title: string;
  component: ComponentType<{ saveId: string }>;
}

const registry = {
  character: { title: '角色', component: Character },
  bag: { title: '行囊', component: Bag },
  skills: { title: '技能', component: Skills },
  quests: { title: '任务', component: Quests },
  people: { title: '人物', component: People },
  beasts: { title: '灵兽', component: Beasts },
  world: { title: '世界', component: World },
  map: { title: '地图', component: MapSheet },
  saves: { title: '存档', component: SavesSheet },
  settings: { title: '设置', component: Settings },
  // the cultivation life (gameplay plan item 13): opened from the standing commands, not the navigation
  cultivate: { title: '修炼', component: CultivateSheet },
  rest: { title: '调息', component: RestSheet },
  wait: { title: '静候', component: WaitSheet },
  // the cultivation life (gameplay plan items 18 and 24): the calendar from the commands' 日历, the
  // gate's preparation sheet from the next gate's card (its title is the gate's own name)
  calendar: { title: '日历', component: CalendarSheet },
  gate: { title: '冲关', component: GatePanel },
  // the cultivation life's book (gameplay plan item 38): its volumes and 回, from the book's head
  contents: { title: '目录', component: ContentsSheet },
  // the cultivation life (gameplay plan item 35): 差事 and 买卖 on the bar open the board and the shop
  notices: { title: '告示', component: NoticesSheet },
  shop: { title: '店铺', component: ShopSheet },
  craft: { title: '炼制', component: CraftSheet },
  // the cultivation life (gameplay plan items 45 and 43): the home and the arrays where the player is,
  // from the 面板 menu and the place's line in 去处
  home: { title: '洞府', component: HomeSheet },
  arrays: { title: '阵法', component: ArraysSheet },
  // the cultivation life (gameplay plan item 46): the sect, from the navigation of a life save
  sect: { title: '宗门', component: SectSheet },
  // the cultivation life (gameplay plan item 49): the heir, from the card at the end of the days; the
  // life's record, from the navigation and the choice
  legacy: { title: '传承', component: LegacySheet },
  life: { title: '一生', component: LifeSheet },
  // the cultivation life (the owner's second playtest): a thread 接下来 offered, taken up by 接着办
  thread: { title: '接着办', component: ThreadSheet },
} satisfies Record<Exclude<SheetName, 'nav'>, SheetEntry>;

export type SheetKey = keyof typeof registry;

export const SHEET_KEYS = Object.keys(registry) as SheetKey[];

/** Every panel the play screen opens, by its name: none is left without one. */
export const sheets: Readonly<Record<SheetKey, SheetEntry>> = registry;

export { aimSheet, type SheetAim } from './aim';
