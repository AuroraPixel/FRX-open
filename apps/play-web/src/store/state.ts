// The state view of the save being played (docs/play-contracts.md, 状态视图). Server data has one
// home: panels read it from here and keep no copy of their own.
import { create } from 'zustand';
import type { Change, StateView } from '../contracts';
import { ApiError, play } from '../api/client';

export interface StateStore {
  saveId: string | null;
  view: StateView | null;
  /** what the last turn or panel action changed, for the bars and rings to move */
  changes: Change[];
  /** the view before that turn or panel action, to tell what it moved: the main line's and the next gate's
   *  cards show whole only when it moved them (none after a load or a 撤回) */
  before: StateView | null;
  loading: boolean;
  error: ApiError | null;
  load: (saveId: string) => Promise<void>;
  /** a turn's or a panel action's view; `fresh` (a load, 撤回, catching up) keeps no view before it */
  set: (view: StateView, changes?: Change[], options?: { fresh?: boolean }) => void;
  /** a turn finished: the save moved on to this version */
  setVersion: (version: number) => void;
  reset: () => void;
}

const empty = { saveId: null, view: null, changes: [], before: null, loading: false, error: null };

export const useStateStore = create<StateStore>()((set, get) => ({
  ...empty,
  async load(saveId) {
    set({ saveId, loading: true, error: null });
    try {
      const view = await play.state(saveId);
      if (get().saveId === saveId) set({ view, changes: [], before: null, loading: false });
    } catch (error) {
      if (get().saveId === saveId) set({ loading: false, error: error instanceof ApiError ? error : new ApiError('network') });
    }
  },
  set(view, changes = [], options = {}) {
    set({ view, changes, before: options.fresh ? null : get().view });
  },
  setVersion(version) {
    const view = get().view;
    if (view && view.version !== version) set({ view: { ...view, version } });
  },
  reset() {
    set(empty);
  },
}));
