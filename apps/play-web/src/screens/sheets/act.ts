// What the panels do to the save: panel actions that take effect at once (POST …/actions) and chips
// for the action queue that go out with the next turn, each with the notice the player sees.
import { useCallback, useState } from 'react';
import { ApiError } from '../../api/client';
import type { PanelResult, QueueItem } from '../../contracts';
import { useQueueStore } from '../../store/queue';
import { useStateStore } from '../../store/state';
import { useTurnsStore } from '../../store/turns';
import { useUiStore } from '../../store/ui';

/** True while a turn is being written: the server refuses panel actions until it is done. */
export function useTurnBusy(): boolean {
  return useTurnsStore((s) => s.live?.status === 'streaming');
}

type Call = (version: number) => Promise<PanelResult>;
/** What the player is told once the action is done: fixed words, or words from what it did. */
type Done = string | ((result: PanelResult) => string);

async function attempt(saveId: string, call: Call, done: Done, setPending: (on: boolean) => void): Promise<boolean> {
  const view = useStateStore.getState().view;
  if (!view) return false;
  const { notify } = useUiStore.getState();
  setPending(true);
  try {
    const result = await call(view.version);
    useStateStore.getState().set(result.state, result.changes);
    // chips the action queued (a beast's evolution) go out with the next turn
    for (const chip of result.queue ?? []) useQueueStore.getState().add(chip);
    notify(typeof done === 'function' ? done(result) : done);
    return true;
  } catch (error) {
    const problem = error instanceof ApiError ? error : new ApiError('network');
    if (problem.code === 'version_conflict') {
      // the save moved on elsewhere: show it as it is now, and let the player try again on that
      void useStateStore.getState().load(saveId);
      notify('这个存档在别处被改过，已重新载入，再试一次。');
    } else if (problem.retryable) {
      notify(problem.message, 'error', () => void attempt(saveId, call, done, () => {}));
    } else {
      notify(problem.message);
    }
    return false;
  } finally {
    setPending(false);
  }
}

/**
 * Runs panel actions one at a time. The state view the server answers with replaces the store's, so
 * every panel shows the new totals at once; while one runs, or while a turn is being written, the
 * panel's action buttons wait (`blocked`).
 */
export function usePanelAction(saveId: string) {
  const [pending, setPending] = useState(false);
  const busy = useTurnBusy();
  const run = useCallback((call: Call, done: Done) => attempt(saveId, call, done, setPending), [saveId]);
  return { run, pending, busy, blocked: pending || busy };
}

/** Puts a chip in the action queue and says so; false when the same chip is already waiting. */
export function queueChip(item: QueueItem): boolean {
  const added = useQueueStore.getState().add(item);
  useUiStore.getState().notify(added ? `已放进行动签：${item.text}` : `行动签里已有：${item.text}`);
  return added;
}
