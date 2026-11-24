// The play screen (plan items 27–30), as the route opens it: the save's state and its latest turns, then
// any turn still under way; a failure to open says so, and the page (PlayPage.tsx) is drawn once they are
// in. Coming back from the background picks up a turn that went on meanwhile.
import { useEffect, useState } from 'react';
import { expectOpening } from '../../lib/opening';
import { useQueueStore } from '../../store/queue';
import { useStateStore } from '../../store/state';
import { useTurnsStore } from '../../store/turns';
import { useUiStore } from '../../store/ui';
import { LoadingScreen } from '../../ui/Loading';
import { FailurePage } from '../Failure';
import { PlayPage } from './PlayPage';

/**
 * Opens the save: its state and its latest turns, then any turn still under way. The page itself is
 * drawn once they are in, so everything on it can count on its elements being there.
 */
export function PlayScreen({ saveId }: { saveId: string }) {
  const view = useStateStore((s) => s.view);
  const stateSave = useStateStore((s) => s.saveId);
  const stateLoading = useStateStore((s) => s.loading);
  const stateError = useStateStore((s) => s.error);
  const turnsSave = useTurnsStore((s) => s.saveId);
  const turnCount = useTurnsStore((s) => s.turns.length);
  const loading = useTurnsStore((s) => s.loading);
  const live = useTurnsStore((s) => s.live);
  const turnsError = useTurnsStore((s) => s.error);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    // the words and chips of another save go; this save's wait for the player (back from signing in)
    const ui = useUiStore.getState();
    if (ui.inputFor !== saveId) {
      useQueueStore.getState().clear();
      ui.setDraft('');
      ui.setInputFor(saveId);
    }
    ui.setDock('half');
    expectOpening();
    let open = true;
    void Promise.all([
      useStateStore.getState().load(saveId),
      useTurnsStore.getState().load(saveId),
    ]).then(async () => {
      if (!open) return;
      await useTurnsStore.getState().resume();
      if (open) await useTurnsStore.getState().startOpening();
    });
    // back from the background: a turn may have gone on without us (spec 十一)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void useTurnsStore.getState().resume();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      open = false;
      document.removeEventListener('visibilitychange', onVisible);
      useTurnsStore.getState().stop();
      useUiStore.getState().closeSheet();
    };
  }, [saveId]);

  // once open, the page stays while the save reloads (after a version conflict)
  const ready = view !== null && stateSave === saveId && !stateLoading && turnsSave === saveId && !(loading && turnCount === 0);
  useEffect(() => {
    if (ready) setOpened(true);
  }, [ready]);

  if (!opened && stateError) return <FailurePage title="存档没能打开" text={stateError.message} />;
  if (!opened && turnsError && turnCount === 0 && !loading && !live) {
    return <FailurePage title="回合没能取来" text={turnsError.message} />;
  }
  if (!view || (!opened && !ready)) return <LoadingScreen />;
  return <PlayPage saveId={saveId} view={view} />;
}
