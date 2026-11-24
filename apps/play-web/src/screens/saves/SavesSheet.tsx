// 存档 as a panel of the play screen: the same list, the save being played edged in gold and kept from
// being deleted; loading another save leaves this one for it.
import type { SaveSummary } from '../../contracts';
import { navigate } from '../../router';
import { useUiStore } from '../../store/ui';
import { SavesList, useSaves } from './SavesList';

export function SavesSheet({ saveId }: { saveId: string }) {
  const state = useSaves();
  const closeSheet = useUiStore((s) => s.closeSheet);
  const load = (save: SaveSummary) => {
    closeSheet();
    if (save.id !== saveId) navigate({ name: 'play', id: save.id });
  };
  return (
    <SavesList
      state={state}
      current={saveId}
      playing={saveId}
      onLoad={load}
      onNew={() => {
        closeSheet();
        navigate({ name: 'new' });
      }}
    />
  );
}
