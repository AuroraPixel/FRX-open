// The interface's own state: which panel is open, where the phone's book page is docked, which
// colour set is showing, and the notices on screen.
import { create } from 'zustand';
import type { DockStop } from '../ui/drag';

export type SheetName =
  | 'nav'
  | 'character'
  | 'bag'
  | 'skills'
  | 'quests'
  | 'people'
  | 'beasts'
  | 'world'
  | 'map'
  | 'saves'
  | 'settings'
  // the cultivation life's standing commands that take a length (修炼, 调息, 静候), one panel in three forms
  | 'cultivate'
  | 'rest'
  | 'wait'
  // the cultivation life's calendar (日历) and the next gate's preparation sheet (准备单)
  | 'calendar'
  | 'gate'
  // the cultivation life's book: its volumes and 回 (目录), from the volume at the book's head
  | 'contents'
  // the cultivation life's notices (差事), shops (买卖) and recipes (炼制)
  | 'notices'
  | 'shop'
  | 'craft'
  // the cultivation life's home (洞府) and arrays (阵法)
  | 'home'
  | 'arrays'
  // the cultivation life's sect (宗门, gameplay plan item 46), the heir (传承) and the life's record (一生, item 49)
  | 'sect'
  | 'legacy'
  | 'life'
  // the cultivation life's threads (线头): what a scene left open, taken up by 接着办 from 接下来
  | 'thread';

export type Light = 'night' | 'day';

export interface Notice {
  id: number;
  text: string;
  kind: 'info' | 'error';
  retry?: () => void;
}

export interface UiStore {
  sheet: SheetName | null;
  dock: DockStop;
  /** phones: where the page was when the line took it fully open for the keyboard; sending puts it back
   *  there, so a reader who opened the page fully keeps it open (null while the line is not in use) */
  lineDock: DockStop | null;
  light: Light;
  notices: Notice[];
  /** what the player is writing; kept while panels open and close, and when a turn fails */
  draft: string;
  /** the save the draft and the action chips belong to: kept while the player is away (signing in again) */
  inputFor: string | null;
  /** the cultivation life's map panel: 近处 (a list, the panel as wide as the others) or 全图 (wide) */
  mapPage: 'near' | 'map';
  setMapPage: (page: 'near' | 'map') => void;
  openSheet: (sheet: SheetName) => void;
  closeSheet: () => void;
  /** the reader moves the phone page (its head, a swipe up its text, a pull down at the text's top):
   *  their own choice stands from then on, the line's earlier place is forgotten */
  setDock: (dock: DockStop) => void;
  /** phones: the line took the focus, the page opens fully for the keyboard */
  openForLine: () => void;
  /** phones: a turn was sent; the page goes back where the reader had it before the line opened it.
   *  Not tied to the line losing the focus: a tap on the send diamond takes the focus first on some
   *  phones and not on others */
  dockAfterSending: () => void;
  setLight: (light: Light) => void;
  setDraft: (draft: string) => void;
  setInputFor: (saveId: string | null) => void;
  notify: (text: string, kind?: Notice['kind'], retry?: () => void) => void;
  dismiss: (id: number) => void;
}

let counter = 0;

export const useUiStore = create<UiStore>()((set) => ({
  sheet: null,
  dock: 'half',
  lineDock: null,
  light: 'night',
  notices: [],
  draft: '',
  inputFor: null,
  mapPage: 'near',
  setMapPage: (mapPage) => set({ mapPage }),
  // the map panel opens on 近处 again
  openSheet: (sheet) => set(sheet === 'map' ? { sheet, mapPage: 'near' } : { sheet }),
  closeSheet: () => set({ sheet: null }),
  setDock: (dock) => set({ dock, lineDock: null }),
  openForLine: () => set((s) => ({ lineDock: s.lineDock ?? s.dock, dock: 'full' })),
  dockAfterSending: () => set((s) => ({ dock: s.lineDock ?? s.dock, lineDock: null })),
  setLight: (light) => set({ light }),
  setDraft: (draft) => set({ draft }),
  setInputFor: (inputFor) => set({ inputFor }),
  notify: (text, kind = 'info', retry) => {
    counter += 1;
    const id = counter;
    // an error replaces an earlier one; at most three notices stand at a time
    set((s) => ({
      notices: [...s.notices.filter((n) => kind === 'info' || n.kind !== 'error'), { id, text, kind, retry }].slice(-3),
    }));
  },
  dismiss: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
}));

/** The colour set for a time of day: night and dusk are night; dawn and daytime are day (spec 九). */
export function lightFor(hour: 'night' | 'dawn' | 'day' | 'dusk'): Light {
  return hour === 'dawn' || hour === 'day' ? 'day' : 'night';
}
