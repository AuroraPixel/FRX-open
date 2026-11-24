// The turns of the save being played: the history page by page, and the turn being written, with
// what can be done to it (spec 五, 回合菜单 and 各种状态): send, retry, cancel, finish a pending
// settlement, go back to an earlier turn.
import { create } from 'zustand';
import type { Move, QueueItem, RealmStep, Turn, TurnEvent, TurnRequest, Verb } from '../contracts';
import { ApiError, play } from '../api/client';
import { streamTurn } from '../api/events';
import { actionText } from '../lib/story';
import { useAccount } from './account';
import { type LiveTurn, applyEvent, placeTurn, startLive } from './merge';
import { useQueueStore } from './queue';
import { useStateStore } from './state';
import { liveText } from './text';
import { useUiStore } from './ui';

export interface SendInput {
  text: string;
  /** Server-provided idempotency key for the automatic opening only. */
  requestId?: string;
  option?: number;
  queue?: QueueItem[];
  /** the cultivation life: a standing command, the action card picked (from 1), a move in a fight, a step
   *  in a secret realm. Each goes alone, with no words and no chips; `text` is then only the stroke shown
   *  until the server answers */
  verb?: Verb;
  act?: number;
  move?: Move;
  step?: RealmStep;
}

export interface TurnsStore {
  saveId: string | null;
  /** finished turns, oldest first */
  turns: Turn[];
  /** older turns remain on the server */
  more: boolean;
  loading: boolean;
  /** the turn being written, or the last one that failed, was cancelled or waits for its settlement */
  live: LiveTurn | null;
  /** 1 to 3 while a dropped stream is being picked up again, otherwise 0 */
  reconnecting: number;
  /** the last request that failed outright */
  error: ApiError | null;
  /** the save was changed elsewhere: only a reload helps (the version-conflict dialog) */
  conflict: boolean;
  /** the last turn sent: sent again as it is when it failed before the server took it */
  request: TurnRequest | null;
  /**
   * the server named the last turn sent (its `turn` event came): it holds the request, so a retry
   * asks for the turn's retry. The turn's id is the request's own id, so the ids cannot tell.
   */
  taken: boolean;
  /** the server has been asked once for a turn under way, after the history loaded */
  checked: boolean;
  load: (saveId: string) => Promise<void>;
  loadEarlier: () => Promise<void>;
  send: (input: SendInput) => Promise<void>;
  /** Start a fresh save's opening after state, history and any pending turn are checked. */
  startOpening: () => Promise<void>;
  /** the failed turn again: the same request when the server never took it, else the turn's retry */
  retry: () => Promise<void>;
  /** the last finished turn written anew (the turn menu's 重试) */
  redo: () => Promise<void>;
  /** stops the turn being written */
  cancel: () => Promise<void>;
  /** finishes the settlement of a turn whose text arrived but whose settlement did not (待结算) */
  settle: () => Promise<void>;
  /** back to the end of turn `toTurn` (回到此处); without it the last turn is taken back (撤回) */
  undo: (toTurn?: number) => Promise<boolean>;
  /** forgets the failed or cancelled turn (改写行动) */
  discard: () => void;
  /** after a version conflict: the save's state and turns as they are now */
  reload: () => Promise<void>;
  /** picks up a turn still under way on the server, after a reload or a return to the page */
  resume: () => Promise<void>;
  /** folds one event in; the stream calls it, tests and fixtures may too */
  apply: (event: TurnEvent) => void;
  stop: () => void;
}

let controller: AbortController | null = null;
/** a resume is asking the server for the turn under way: a second one waits its turn */
const resuming = new Map<string, Promise<void>>();
/** the last turn whose events had gone when it was picked up: reloaded once, never in a loop */
let gone: string | null = null;

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  const hex = [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16));
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-4${hex.slice(13, 16).join('')}-a${hex.slice(17, 20).join('')}-${hex.slice(20).join('')}`;
}

const initial = {
  saveId: null,
  turns: [],
  more: false,
  loading: false,
  live: null,
  reconnecting: 0,
  error: null,
  conflict: false,
  request: null,
  taken: false,
  checked: false,
};

/** Codes that mean the server holds a turn of its own: show that one instead. */
const BUSY = new Set(['turn_in_progress', 'pending_settlement']);
export const TURN_STREAM_IDLE_MS = 30_000;
const TURN_STATUS_TIMEOUT_MS = 12_000;

export const useTurnsStore = create<TurnsStore>()((set, get) => {
  const failed = (error: unknown) => (error instanceof ApiError ? error : new ApiError('network'));
  const version = () => useStateStore.getState().view?.version;

  /**
   * A turn the server took and then failed or stopped leaves the save at a later version: it wrote
   * the player's line before asking the model. Without the save as it is now, the next turn or the
   * retry carries the old version and is refused as a conflict (实玩二, 第二十一回: 重试 after a model
   * failure brought up 「存档已在别处改过」).
   */
  async function catchUp(saveId: string) {
    try {
      const view = await play.state(saveId);
      if (get().saveId === saveId && view.version !== version()) useStateStore.getState().set(view, [], { fresh: true });
    } catch {
      // the next turn says what is wrong, if anything still is
    }
  }

  /**
   * Follows a turn's events to the end. `queue` is what went with the turn: when the server refuses
   * the turn before naming it, the chips go back above the input.
   */
  async function follow(
    start: (signal?: AbortSignal) => Promise<Response>,
    { from, queue = [], requestId }: { from?: { turnId: string; after: number }; queue?: QueueItem[]; requestId?: string } = {},
  ) {
    const currentSave = get().saveId;
    if (!currentSave) return;
    const saveId = currentSave;
    controller?.abort();
    const own = new AbortController();
    controller = own;
    let liveTurnId = from?.turnId;
    let named = Boolean(liveTurnId);
    let lastActivity = Date.now();
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const stillFollowing = () => controller === own && get().live?.status === 'streaming';
    const scheduleCheck = () => {
      idleTimer = setTimeout(() => void checkQuiet(), Math.max(0, TURN_STREAM_IDLE_MS - (Date.now() - lastActivity)));
    };
    async function checkQuiet() {
      if (!stillFollowing()) return;
      if (Date.now() - lastActivity < TURN_STREAM_IDLE_MS) {
        scheduleCheck();
        return;
      }
      lastActivity = Date.now();
      const id = liveTurnId ?? requestId;
      if (!id) {
        scheduleCheck();
        return;
      }
      const probe = new AbortController();
      const stopProbe = () => probe.abort();
      const deadline = setTimeout(stopProbe, TURN_STATUS_TIMEOUT_MS);
      own.signal.addEventListener('abort', stopProbe, { once: true });
      try {
        const pending = await play.pending(saveId, probe.signal);
        if (!stillFollowing() || pending?.status === 'streaming') return;
        const saved = pending?.id === id ||
          (await play.turns(saveId, undefined, probe.signal)).turns.some((turn) => turn.id === id);
        if (!saved || !stillFollowing()) return;
        controller = null;
        own.abort();
        await get().reload();
      } catch {
        // Keep the existing stream while a status read fails or times out.
      } finally {
        clearTimeout(deadline);
        own.signal.removeEventListener('abort', stopProbe);
        if (stillFollowing()) scheduleCheck();
      }
    }
    const giveBack = () => {
      if (!named && queue.length) useQueueStore.getState().restore(queue);
    };
    scheduleCheck();
    try {
      const end = await streamTurn({
        saveId,
        start,
        signal: own.signal,
        turnId: from?.turnId,
        after: from?.after,
        onEvent: (event) => {
          lastActivity = Date.now();
          if (event.event === 'turn') {
            liveTurnId = event.turn.id;
            named = true;
            if (!get().taken) set({ taken: true });
          }
          get().apply(event);
        },
        // a stream that was let go for another one is not reconnecting
        onReconnect: (attempt) => {
          if (controller === own && !own.signal.aborted) set({ reconnecting: attempt });
        },
      });
      set({ reconnecting: 0 });
      if (end === 'error') {
        const code = get().live?.error?.code;
        if (code === 'cancelled') useQueueStore.getState().restore(queue);
        else giveBack();
        if (code === 'version_conflict') set({ conflict: true });
        else if (named) await catchUp(saveId);
      }
    } catch (error) {
      const problem = failed(error);
      if (problem.code === 'aborted') return;
      if (problem.code === 'unauthorized') keepForReturn(named);
      if (liveTurnId && problem.code === 'not_found' && gone !== liveTurnId) {
        gone = liveTurnId;
        // The server may have committed the turn before a restart or before its events expired.
        set({ live: null, reconnecting: 0 });
        if (controller === own) controller = null;
        await get().reload();
        return;
      }
      giveBack();
      if (!named && BUSY.has(problem.code)) {
        // another turn of this save is under way or waits for its settlement: show that one
        set({ live: null, reconnecting: 0 });
        if (controller === own) controller = null;
        await get().resume();
        return;
      }
      // refused at the player's usage limit or by a full server (429): the reason stands where the turn
      // would, and the words wait in the input for when play may go on (accounts plan, W-3)
      if (!named && problem.status === 429) wordsBack();
      const live = get().live;
      set({
        reconnecting: 0,
        error: problem,
        conflict: get().conflict || problem.code === 'version_conflict',
        live: live && {
          ...live,
          status: 'failed',
          open: null,
          error: { code: problem.code, message: problem.message, retryable: problem.retryable },
        },
      });
    } finally {
      clearTimeout(idleTimer);
      if (controller === own) controller = null;
    }
  }

  /** The words of the turn being sent back in the input, unless the player has written there meanwhile. */
  function wordsBack(): boolean {
    const { live, request } = get();
    if (!request || live?.id !== request.requestId) return false;
    const ui = useUiStore.getState();
    if (!ui.draft.trim()) ui.setDraft(request.input);
    return true;
  }

  /**
   * The session went while a turn was on its way, and the login takes the player away from the save
   * (store/account.ts). A turn the server never took leaves its words in the input (its chips are
   * given back already); one it took goes on there and is picked up on the player's return.
   */
  function keepForReturn(named: boolean) {
    if (!named && wordsBack()) {
      useAccount.getState().noteTurn('unsent');
    } else if (named) {
      useAccount.getState().noteTurn('running');
    }
  }

  /** Sends the request as it is: the same requestId, so the server never runs a turn twice. */
  async function post(request: TurnRequest) {
    const saveId = get().saveId;
    if (!saveId) return;
    await follow((signal) => play.postTurn(saveId, request, signal), {
      queue: request.queue ?? [], requestId: request.requestId,
    });
  }

  return {
    ...initial,

    async load(saveId) {
      controller?.abort();
      liveText.clear();
      set({ ...initial, saveId, loading: true });
      try {
        const page = await play.turns(saveId);
        if (get().saveId === saveId) set({ turns: page.turns, more: page.more, loading: false });
      } catch (error) {
        if (get().saveId === saveId) set({ loading: false, error: failed(error) });
      }
    },

    async loadEarlier() {
      const { saveId, turns, more, loading } = get();
      const first = turns[0];
      if (!saveId || !more || loading || !first) return;
      set({ loading: true });
      try {
        const page = await play.turns(saveId, first.no);
        if (get().saveId !== saveId) return;
        set((s) => ({ turns: page.turns.reduce(placeTurn, s.turns), more: page.more, loading: false }));
      } catch (error) {
        set({ loading: false, error: failed(error) });
      }
    },

    async startOpening() {
      const { saveId, loading, checked, turns, live, error, conflict } = get();
      const state = useStateStore.getState();
      const opening = state.view?.openingRequestId;
      if (!saveId || state.saveId !== saveId || !opening || state.loading || state.error
          || state.view?.turnNo !== 0 || loading || !checked || turns.length || live || error || conflict) return;
      await get().send({ text: '踏入仙途', requestId: opening });
    },

    async send({ text, requestId = uuid(), option, queue, verb, act, move, step }) {
      const saveId = get().saveId;
      const at = version();
      const busy = get().live?.status;
      if (!saveId || at === undefined || busy === 'streaming' || busy === 'pending') return;
      const no = (get().turns[get().turns.length - 1]?.no ?? 0) + 1;
      const command = Boolean(verb || act || move || step);
      const request: TurnRequest = {
        requestId,
        version: at,
        input: command ? '' : text,
        ...(option ? { option } : {}),
        ...(queue?.length && !command ? { queue } : {}),
        ...(verb ? { verb } : {}),
        ...(act ? { act } : {}),
        ...(move ? { move } : {}),
        ...(step ? { step } : {}),
      };
      liveText.clear();
      set({ live: startLive(requestId, no, text, command ? undefined : queue), error: null, request, taken: false });
      await post(request);
    },

    async retry() {
      const { saveId, live, request } = get();
      const at = version();
      if (!saveId || !live || live.status === 'streaming' || at === undefined) return;
      liveText.clear();
      const text = actionText(live.blocks);
      const queue = request?.queue;
      if (request && live.id === request.requestId && !get().taken) {
        // the server never named the turn: the same request again (sent again once it has, the same
        // id would only bring back the failed attempt: 「这一回合没有完成」, and nothing retried). Its
        // chips were given back to the queue when it was refused: they leave the queue again and go with
        // it, those still there (the documents pass, #17: left there too, they went out again with the
        // next turn)
        const chips = queue?.length ? useQueueStore.getState().reclaim(queue) : [];
        const { queue: _given, ...rest } = request;
        const again: TurnRequest = { ...rest, ...(chips.length ? { queue: chips } : {}) };
        set({ live: startLive(request.requestId, live.no, text, chips.length ? chips : undefined), error: null, request: again });
        await post(again);
        return;
      }
      set({ live: { ...startLive(live.id, live.no, text, queue) }, error: null });
      await follow((signal) => play.retry(saveId, live.id, { version: at }, signal));
    },

    async redo() {
      const { saveId, turns, live } = get();
      const last = turns[turns.length - 1];
      const at = version();
      if (!saveId || !last || at === undefined || live?.status === 'streaming') return;
      liveText.clear();
      set({
        turns: turns.slice(0, -1),
        live: startLive(last.id, last.no, actionText(last.blocks)),
        error: null,
        request: null,
      });
      await follow((signal) => play.retry(saveId, last.id, { version: at }, signal));
    },

    async cancel() {
      const { saveId, live, request } = get();
      if (!saveId || !live || live.status !== 'streaming') return;
      controller?.abort();
      controller = null;
      liveText.clear();
      // the turn's id is the request's own: only its turn event says the server took it
      const named = !request || live.id !== request.requestId || get().taken;
      set({
        reconnecting: 0,
        live: { ...live, open: null, settling: true },
      });
      if (named) {
        const result = await play.cancel(saveId, live.id).catch(() => null);
        if (get().saveId !== saveId) return;
        // The commit may have won the race with cancellation. Read its durable result before
        // offering retry or returning queued actions; pending repairs also remain pending.
        if (result?.status !== 'cancelled') {
          await get().reload();
          return;
        }
        await catchUp(saveId);
      }
      if (get().saveId !== saveId || get().live?.id !== live.id) return;
      set({ live: { ...live, status: 'cancelled', open: null, error: { code: 'cancelled', message: '这一回合已取消。', retryable: false } } });
      if (request?.queue?.length) useQueueStore.getState().restore(request.queue);
    },

    async settle() {
      const { saveId, live } = get();
      const at = version();
      if (!saveId || !live || live.status !== 'pending' || at === undefined) return;
      set({ live: { ...live, status: 'streaming', settling: true, error: undefined }, error: null });
      await follow((signal) => play.retry(saveId, live.id, { version: at }, signal));
    },

    async undo(toTurn) {
      const saveId = get().saveId;
      const at = version();
      if (!saveId || at === undefined || get().live?.status === 'streaming') return false;
      try {
        // 撤回 sends no turn: the server takes back its latest, pending ones included
        const result = await play.undo(saveId, toTurn === undefined ? { version: at } : { version: at, toTurn });
        useStateStore.getState().set(result.state, [], { fresh: true });
        liveText.clear();
        const kept = result.state.turnNo;
        set((s) => ({ turns: s.turns.filter((t) => t.no <= kept), live: null, error: null, request: null }));
        return true;
      } catch (error) {
        const problem = failed(error);
        set({ error: problem, conflict: get().conflict || problem.code === 'version_conflict' });
        return false;
      }
    },

    discard() {
      if (get().live?.status === 'streaming') return;
      liveText.clear();
      set({ live: null, error: null });
    },

    async reload() {
      const saveId = get().saveId;
      if (!saveId) return;
      await Promise.all([useStateStore.getState().load(saveId), get().load(saveId)]);
      await get().resume();
    },

    async resume() {
      const saveId = get().saveId;
      if (!saveId || controller) return;
      const checking = resuming.get(saveId);
      if (checking) {
        await checking;
        return;
      }
      let checked!: () => void;
      resuming.set(saveId, new Promise<void>((resolve) => { checked = resolve; }));
      let turn: Turn | null = null;
      try {
        try {
          turn = await play.pending(saveId);
        } catch (error) {
          if (get().saveId === saveId && failed(error).code !== 'not_found') set({ error: failed(error) });
        }
        if (get().saveId !== saveId) return;
        set({ checked: true });
        if (!turn) return; // nothing under way (204)
        if (turn.status !== 'streaming') {
          set({ live: { id: turn.id, no: turn.no, status: turn.status, blocks: turn.blocks, open: null } });
          return;
        }
        // the events from the first one rebuild the turn, so it starts empty
        liveText.clear();
        set({ live: { id: turn.id, no: turn.no, status: 'streaming', blocks: [], open: null } });
      } finally {
        resuming.delete(saveId);
        checked();
      }
      await follow((signal) => play.turnEvents(saveId, turn.id, 0, signal), { from: { turnId: turn.id, after: 0 } });
    },

    apply(event) {
      const outcome = applyEvent(get().live, event, liveText);
      switch (outcome.kind) {
        case 'live':
          set({ live: outcome.live });
          break;
        case 'done':
          set((s) => ({ live: null, turns: placeTurn(s.turns, outcome.turn) }));
          useStateStore.getState().setVersion(outcome.version);
          break;
        case 'state':
          useStateStore.getState().set(outcome.event.state, outcome.event.changes);
          break;
        default:
          break;
      }
    },

    stop() {
      controller?.abort();
      controller = null;
    },
  };
});
