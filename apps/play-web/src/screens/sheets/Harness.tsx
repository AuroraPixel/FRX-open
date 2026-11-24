// The panels on their own (#/gallery/panels, development and screenshot builds only): the first save
// of a sample set (?fixture=full) with one panel open in the real Sheet (?sheet=bag), optionally on
// a tab, with something picked (?tab=, ?pick=) and scrolled to its end (?scroll=end) or to the element
// of an id (?scroll=settings-paper brings 设置's 日报 to the top). The chips the
// panels put in the action queue stand at the top left. The play screen shows the same panels over
// the stage; this page keeps their screenshots free of everything else.
import { Suspense, useEffect, useRef, useState } from 'react';
import { play } from '../../api/client';
import { readParams } from '../../lib/params';
import { chipText } from '../../lib/story';
import { useReady } from '../../lib/ready';
import { useQueueStore } from '../../store/queue';
import { useStateStore } from '../../store/state';
import { type SheetName, useUiStore } from '../../store/ui';
import { Btn } from '../../ui/Btn';
import { Chip } from '../../ui/Chip';
import { Loading } from '../../ui/Loading';
import { Sheet } from '../../ui/Sheet';
import { PHONE, useMedia } from '../../ui/useMedia';
import { aimSheet } from './aim';
import { loadArtLists, useArtLists } from './art';
import { SHEET_KEYS, sheets } from './index';
import styles from './Harness.module.css';

/** Resolves once nothing in the sheet is still loading and every picture in it has arrived. */
function settled(root: HTMLElement | null): boolean {
  if (!root || !useArtLists.getState().settled) return false;
  if (root.querySelector('[role="status"]')) return false;
  return [...root.querySelectorAll('img')].every((img) => img.complete);
}

/**
 * Leaves no button straddling an edge of the sheet's scrolling body, so a screenshot never shows half
 * a control (and the touch-target check, which measures what is visible, judges whole ones). A cut
 * button is scrolled out of sight where the body can move that way, else fully into it.
 */
function unclip(body: HTMLElement): void {
  for (let round = 0; round < 4; round += 1) {
    const edge = body.getBoundingClientRect();
    const boxes = [...body.querySelectorAll('button')].map((button) => button.getBoundingClientRect());
    const room = { down: body.scrollHeight - body.clientHeight - body.scrollTop, up: body.scrollTop };
    const top = boxes.find((box) => box.top < edge.top && box.bottom > edge.top);
    const bottom = boxes.find((box) => box.top < edge.bottom && box.bottom > edge.bottom);
    if (top) {
      const hide = Math.ceil(top.bottom - edge.top) + 1;
      body.scrollTop += hide <= room.down ? hide : -(Math.ceil(edge.top - top.top) + 1);
    } else if (bottom) {
      const hide = Math.ceil(edge.bottom - bottom.top) + 1;
      body.scrollTop -= hide <= room.up ? hide : -(Math.ceil(bottom.bottom - edge.bottom) + 1);
    } else {
      return;
    }
  }
}

export default function PanelHarness() {
  const [params] = useState(() => readParams(globalThis.location?.href ?? 'http://local/'));
  const [saveId, setSaveId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const view = useStateStore((s) => s.view);
  const open = useUiStore((s) => s.sheet);
  const chips = useQueueStore((s) => s.items);
  const removeChip = useQueueStore((s) => s.remove);
  const layer = useRef<HTMLDivElement>(null);
  const phone = useMedia(PHONE);

  useEffect(() => {
    const name = params.get('sheet') ?? 'character';
    void loadArtLists();
    aimSheet({ sheet: name, tab: params.get('tab') ?? undefined, pick: params.get('pick') ?? undefined });
    useUiStore.getState().openSheet(name as SheetName);
    let live = true;
    void play.saves().then((saves) => {
      const id = saves[0]?.id;
      if (!live || !id) return;
      setSaveId(id);
      void useStateStore.getState().load(id);
    });
    return () => {
      live = false;
    };
  }, [params]);

  // the screenshot waits until the panel has drawn its data and pictures
  useEffect(() => {
    if (!view || ready) return;
    const timer = setInterval(() => {
      const dialog = layer.current?.querySelector<HTMLElement>('[role="dialog"]') ?? null;
      if (!settled(dialog)) return;
      clearInterval(timer);
      const body = dialog?.lastElementChild;
      if (body instanceof HTMLElement) {
        const scroll = params.get('scroll');
        const target = scroll && scroll !== 'end' ? body.querySelector<HTMLElement>(`#${CSS.escape(scroll)}`) : null;
        if (scroll === 'end') body.scrollTop = body.scrollHeight;
        else if (target) body.scrollTop += target.getBoundingClientRect().top - body.getBoundingClientRect().top;
        unclip(body);
      }
      setReady(true);
    }, 50);
    return () => clearInterval(timer);
  }, [view, ready, params]);
  useReady(ready);

  const entry = open && open !== 'nav' ? sheets[open] : undefined;
  const ui = useUiStore.getState();
  return (
    <div className={styles.backdrop} ref={layer}>
      {chips.length > 0 && (
        <div className={styles.chips} aria-label="行动签">
          {chips.map((chip, index) => (
            <Chip key={`${chip.kind}-${chip.text}`} text={chipText(chip, view?.people ?? [])} onRemove={() => removeChip(index)} />
          ))}
        </div>
      )}
      {!open && (
        <div className={styles.reopen}>
          {SHEET_KEYS.map((key) => (
            <Btn key={key} onClick={() => ui.openSheet(key)}>
              {sheets[key]?.title}
            </Btn>
          ))}
        </div>
      )}
      <Sheet
        title={entry?.title ?? '面板'}
        open={open !== null}
        onClose={() => ui.closeSheet()}
        onBack={() => ui.openSheet('nav')}
        // as the play screen's SheetHost: the map is wider on desktops and full height on phones,
        // where it fills the sheet
        size={open === 'map' ? (phone ? 'tall' : 'wide') : 'normal'}
        fill={open === 'map'}
      >
        {entry ? (
          saveId && view ? (
            <Suspense fallback={<Loading text="展开中……" />}>
              <entry.component saveId={saveId} />
            </Suspense>
          ) : (
            <Loading text="载入中……" />
          )
        ) : (
          <div className={styles.nav}>
            {SHEET_KEYS.map((key) => (
              <Btn key={key} onClick={() => ui.openSheet(key)}>
                {sheets[key]?.title}
              </Btn>
            ))}
          </div>
        )}
      </Sheet>
    </div>
  );
}
