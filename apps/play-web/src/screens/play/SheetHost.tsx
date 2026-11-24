// The panel that is open, by name from the interface store. The panels themselves are written
// elsewhere and registered in screens/sheets/index.ts, every one of them; a heavy one fetches its code
// the first time it opens, under a waiting line in its sheet.
import { Suspense } from 'react';
import { useStateStore } from '../../store/state';
import { useUiStore } from '../../store/ui';
import { Loading } from '../../ui/Loading';
import { Sheet } from '../../ui/Sheet';
import { PHONE, useMedia } from '../../ui/useMedia';
import { loadArtLists } from '../sheets/art';
import { DAYS_VERBS } from '../sheets/Cultivate';
import { sheets } from '../sheets';
import { NavGrid } from './Nav';
import styles from './SheetHost.module.css';

/** Starts fetching what the panels show (the item icons, the bestiary), once the page is up. */
export function preloadPanels(): void {
  void loadArtLists().catch(() => undefined);
}

export function SheetHost({ saveId }: { saveId: string }) {
  const sheet = useUiStore((s) => s.sheet);
  const openSheet = useUiStore((s) => s.openSheet);
  const closeSheet = useUiStore((s) => s.closeSheet);
  const gateName = useStateStore((s) => s.view?.play?.gate?.name);
  const life = useStateStore((s) => Boolean(s.view?.play));
  const mapPage = useUiStore((s) => s.mapPage);
  const phone = useMedia(PHONE);
  if (!sheet) return null;
  if (sheet === 'nav') {
    return (
      <Sheet key="nav" title="去处" open fit onClose={closeSheet} className={styles.nav}>
        <NavGrid open={null} onOpen={openSheet} life={life} />
      </Sheet>
    );
  }
  const { title, component: Body } = sheets[sheet];
  // the map is wide on desktops; the cultivation life's 近处 is a list, as wide as the other panels
  const size = sheet === 'map' ? (phone ? 'tall' : life && mapPage === 'near' ? 'normal' : 'wide') : 'normal';
  // 修炼, 调息, 静候: opened from the bottom bar, as tall as the choices and the preview with 开始
  const days = (DAYS_VERBS as readonly string[]).includes(sheet);
  // the gate's sheet: titled with the gate (「筑基」 · 冲关准备); its buttons stay at its foot
  const gate = sheet === 'gate';
  return (
    <Sheet
      key={sheet}
      title={gate && gateName ? gateName : title}
      subtitle={gate ? '冲关准备' : undefined}
      open
      size={size}
      fill={sheet === 'map' || gate}
      fit={days}
      className={days ? styles.days : undefined}
      onClose={closeSheet}
      onBack={phone && !days && !gate && !['calendar', 'notices', 'shop', 'craft', 'contents', 'thread'].includes(sheet) ? () => openSheet('nav') : undefined}
    >
      <Suspense fallback={<Loading text="展开中……" />}>
        <Body saveId={saveId} />
      </Suspense>
    </Sheet>
  );
}
