// 设置 from the title page: the settings panel in its own sheet, over the title. The panel takes the save
// to go on with, for what belongs to a save (rebuilding its memory); without one it gets no save. Its
// code comes when it is first opened, and with it none of the other panels.
import { Suspense, lazy } from 'react';
import { Loading } from '../../ui/Loading';
import { Sheet } from '../../ui/Sheet';

const Settings = lazy(() => import('../sheets/Settings').then((module) => ({ default: module.Settings })));

export function SettingsSheet({ open, saveId, onClose }: { open: boolean; saveId: string | null; onClose: () => void }) {
  if (!open) return null;
  return (
    <Sheet title="设置" open onClose={onClose}>
      <Suspense fallback={<Loading text="展开中……" />}>
        <Settings saveId={saveId ?? ''} />
      </Suspense>
    </Sheet>
  );
}
