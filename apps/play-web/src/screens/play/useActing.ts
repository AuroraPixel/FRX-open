// What the player does on the play screen: send a turn (their own words or an option, with the queued
// chips), take back the words of a failed or cancelled turn, the turn menu (重试, 回到此处, 复制正文)
// with its confirmation, and the panel keys (spec 十二: C 角色, B 行囊, Q 任务, M 地图, unless typing).
// In the cultivation life also an action card (act) and a standing command (verb), each a turn alone.
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { audio } from '../../audio';
import type { ActionCard, Move, OptionItem, RealmStep, Turn, Verb } from '../../contracts';
import { turnWords } from '../../lib/book';
import { actionText, storyText, turnsDropped } from '../../lib/story';
import type { LiveTurn } from '../../store/merge';
import { useQueueStore } from '../../store/queue';
import { useTurnsStore } from '../../store/turns';
import { useUiStore } from '../../store/ui';
import { typingInto } from '../../ui/Opts';
import { sendCommand, sentCommand } from './commands';
import { PANELS } from './Nav';
import type { TurnMenuAction } from './TurnMenu';
import type { UndoAsk } from './TurnStates';

export interface ActingOptions {
  phone: boolean;
  /** the line and the options are locked: a turn is being written or waits, or the save cannot go on */
  locked: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  live: LiveTurn | null;
  /** the finished turns on the page, oldest first */
  shown: Turn[];
  /** the panel keys rest: a close-up or a staged performance is on, or the save was changed elsewhere */
  held: boolean;
  /** the cultivation life's book (item 38): a turn is a 回合, not a 回, in what the page says of it */
  book?: boolean;
}

/** A desktop's mouse and keyboard, not a finger (a phone or a tablet keeps its keyboard down). */
function finePointer(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;
}

export function useActing({ phone, locked, inputRef, live, shown, held, book = false }: ActingOptions) {
  const openSheet = useUiStore((s) => s.openSheet);
  const openForLine = useUiStore((s) => s.openForLine);
  const dockAfterSending = useUiStore((s) => s.dockAfterSending);
  const setDraft = useUiStore((s) => s.setDraft);
  const notify = useUiStore((s) => s.notify);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [undoAsk, setUndoAsk] = useState<UndoAsk | null>(null);
  const lastShown = shown[shown.length - 1];

  // a cancelled turn gives the player's words back to the input (spec 五, 已取消)
  const wasCancelled = useRef<string | null>(null);
  useEffect(() => {
    if (live?.status === 'cancelled' && wasCancelled.current !== live.id) {
      wasCancelled.current = live.id;
      // a card or a command had no words to give back: its cards are there again
      if (!useUiStore.getState().draft.trim() && !sentCommand()) setDraft(actionText(live.blocks));
    }
    if (live?.status === 'failed') audio.play('ui.error');
  }, [live?.status, live?.id, live?.blocks, setDraft]);

  // Sending locks the line and the options while the turn is written (spec 五), which drops the focus of a
  // keyboard player: when they open again, and no close-up or performance holds the page, it goes back
  // where it was, the line or the first option.
  const focusBack = useRef<'line' | 'option' | null>(null);
  useEffect(() => {
    const back = focusBack.current;
    if (locked || held || !back) return;
    focusBack.current = null;
    if (document.activeElement !== null && document.activeElement !== document.body) return;
    const option = back === 'option' ? document.querySelector<HTMLButtonElement>('ol[aria-label="抉择"] button:not(:disabled)') : null;
    (option ?? inputRef.current)?.focus({ preventScroll: true });
  }, [locked, held, inputRef]);

  /** Where the focus goes back once the line and the options open again: the line, the first option. */
  const noteFocus = useCallback(() => {
    const focused = document.activeElement;
    focusBack.current =
      phone || !finePointer()
        ? null
        : focused === inputRef.current
          ? 'line'
          : focused instanceof HTMLElement && focused.closest('ol[aria-label="抉择"]')
            ? 'option'
            : null;
  }, [phone, inputRef]);

  const send = useCallback(
    (text: string, option?: number) => {
      const busy = useTurnsStore.getState().live?.status;
      if (busy === 'streaming' || busy === 'pending') return;
      noteFocus();
      const queue = useQueueStore.getState().take();
      void useTurnsStore.getState().send({ text, option, queue });
      setDraft('');
      setMenuFor(null);
      if (phone) {
        // back where the reader had the page before the line opened it for the keyboard (half for one
        // who wrote from under the picture, full for one reading in the whole screen); an option picked
        // leaves it where it is
        dockAfterSending();
        inputRef.current?.blur();
      }
    },
    [phone, dockAfterSending, setDraft, inputRef, noteFocus],
  );
  const pick = useCallback(
    (item: OptionItem) => {
      audio.play('ui.tap');
      send(item.text, item.index);
    },
    [send],
  );

  // the cultivation life: a card picked sends act with its number, its title the stroke until the
  // server answers; a standing command goes with no stroke. Neither takes the line's words or the chips,
  // and the page stays where it is, as for an option.
  const act = useCallback(
    (card: ActionCard) => {
      if (card.locked) return;
      noteFocus();
      if (!sendCommand({ act: card.index, shown: card.title })) return;
      audio.play('ui.tap');
      setMenuFor(null);
    },
    [noteFocus],
  );
  const command = useCallback((verb: Verb) => {
    if (!sendCommand({ verb })) return false;
    setMenuFor(null);
    return true;
  }, []);
  /** a move in a fight: 攻 御 遁 察 和 at once, 术 and 物 once their picker has chosen */
  const fight = useCallback((move: Move) => {
    if (!sendCommand({ move })) return;
    audio.play('ui.tap');
    setMenuFor(null);
  }, []);
  /** a step in a secret realm: a node of the next layer, or out past the deepest */
  const realm = useCallback((step: RealmStep) => {
    if (!sendCommand({ step })) return;
    audio.play('ui.tap');
    setMenuFor(null);
  }, []);
  /** 写一段: the model writes out the days of turn `no`'s annals line */
  const elaborate = useCallback(
    (no: number) => {
      const turnId = useTurnsStore.getState().turns.find((t) => t.no === no)?.id;
      if (!turnId) return;
      audio.play('ui.tap');
      command({ kind: 'elaborate', turnId });
    },
    [command],
  );

  const rewrite = () => {
    const turn = useTurnsStore.getState();
    if (!turn.live) return;
    if (sentCommand()) {
      // a card or a command: nothing of the player's to rewrite; the cards it answered come back
      turn.discard();
      return;
    }
    setDraft(actionText(turn.live.blocks));
    if (turn.request?.queue?.length) useQueueStore.getState().restore(turn.request.queue);
    turn.discard();
    if (phone) openForLine();
    inputRef.current?.focus();
  };

  const onMenu = (no: number, action: TurnMenuAction) => {
    setMenuFor(null);
    const turn = shown.find((t) => t.no === no);
    if (!turn) return;
    // the last turn, as its menu has it (PlayPage): the latest on the page with nothing after it. A turn
    // that failed or was cancelled after it is the last one then, and 回到此处 here keeps this turn and
    // gives that one up (it took this one back, which the menu never offered)
    const last = no === lastShown?.no && !live;
    if (action === 'retry') void useTurnsStore.getState().redo();
    if (action === 'undo') {
      setUndoAsk(
        last
          ? { toTurn: no - 1, dropped: 1, last }
          : { toTurn: no, dropped: turnsDropped(no, lastShown?.no ?? no) + (live ? 1 : 0), last },
      );
    }
    if (action === 'copy') {
      const text = storyText(turn);
      const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
      if (!clipboard) {
        notify('这里不能复制，浏览器没有给剪贴板。', 'error');
        return;
      }
      clipboard.writeText(text).then(
        () => notify(`已复制${turnWords(no, book)}的正文。`),
        () => notify('没能复制，浏览器拒绝了剪贴板。', 'error'),
      );
    }
  };

  const confirmUndo = async () => {
    const ask = undoAsk;
    setUndoAsk(null);
    if (!ask) return;
    const done = await useTurnsStore.getState().undo(ask.last ? undefined : ask.toTurn);
    if (done) notify(ask.toTurn > 0 ? `已回到${turnWords(ask.toTurn, book)}。` : '已回到开头。');
    else if (!useTurnsStore.getState().conflict) notify(useTurnsStore.getState().error?.message ?? '没能撤回。', 'error');
  };

  // C 角色, B 行囊, Q 任务, M 地图, unless typing (spec 十二)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || typingInto(event.target)) return;
      if (useUiStore.getState().sheet || held || undoAsk) return;
      const panel = PANELS.find((p) => p.key === event.key.toLowerCase());
      if (!panel) return;
      event.preventDefault();
      openSheet(panel.name);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [held, undoAsk, openSheet]);

  return {
    send,
    pick,
    act,
    command,
    elaborate,
    fight,
    realm,
    rewrite,
    onMenu,
    confirmUndo,
    menuFor,
    setMenuFor,
    undoAsk,
    keepTurns: () => setUndoAsk(null),
  };
}
