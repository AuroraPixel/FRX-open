// Where a panel should open: on a tab, with something picked, or ready to fill an equipment slot.
// It is set just before the panel opens (an empty equipment slot opens the bag on that kind; the
// screenshot page opens panels with an entry picked) and read once when the panel mounts.
import { useEffect, useState } from 'react';
import { create } from 'zustand';

export interface SheetAim {
  /** the registry key of the panel it is meant for */
  sheet: string;
  tab?: string;
  /** the id of the item, skill, quest, beast, issue or biography to pick */
  pick?: string;
  /** the equipment slot the bag equips into: 「weapon:2」 */
  slot?: string;
}

export const useSheetAim = create<{ aim: SheetAim | null }>()(() => ({ aim: null }));

export function aimSheet(aim: SheetAim): void {
  useSheetAim.setState({ aim });
}

/**
 * This panel's aim, read when it mounts. It is cleared from an effect, not while rendering, so that a
 * second render of the same mount (React's Strict Mode) still sees it.
 */
export function useAim(sheet: string): SheetAim | null {
  const [aim] = useState(() => {
    const current = useSheetAim.getState().aim;
    return current?.sheet === sheet ? current : null;
  });
  useEffect(() => {
    if (useSheetAim.getState().aim?.sheet === sheet) useSheetAim.setState({ aim: null });
  }, [sheet]);
  return aim;
}
