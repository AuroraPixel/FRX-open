// The component gallery (#/gallery/<section>), in development and screenshot builds only: every base
// component in each state, night and day side by side. ?light=night or ?light=day shows one set
// (the phone screenshots use it). The sheet and dialog sections show the real overlays open.
import { type ReactNode, lazy, useEffect, useState } from 'react';
import { pins } from '../../lib/params';
import { useReady } from '../../lib/ready';
import { navigate } from '../../router';
import { type Light, useUiStore } from '../../store/ui';
import { Btn } from '../../ui/Btn';
import { Dialog } from '../../ui/Dialog';
import { KV } from '../../ui/KV';
import { Sheet } from '../../ui/Sheet';
import { Slot, SlotGrid } from '../../ui/Slot';
import { Sub } from '../../ui/Sub';
import { Tabs } from '../../ui/Tabs';
import {
  ButtonsSection,
  LifeMoreSection,
  LifeBookSection,
  LifeNextSection,
  LifePlacesSection,
  LifeSection,
  MarksSection,
  PanelSection,
  ReadingSection,
  StatusSection,
} from './sections';
import * as sample from './samples';
import styles from './Gallery.module.css';

const SECTIONS = [
  { id: 'status', label: '状态', body: StatusSection },
  { id: 'buttons', label: '钮签', body: ButtonsSection },
  { id: 'reading', label: '正文', body: ReadingSection },
  { id: 'panel', label: '面板', body: PanelSection },
  { id: 'marks', label: '印记', body: MarksSection },
  { id: 'sheet', label: '侧栏', body: null },
  { id: 'dialog', label: '对话', body: null },
  // the real panels with sample data (screens/sheets/Harness.tsx), reached by address only; it says
  // itself when it is drawn
  { id: 'panels', label: '面板页', body: null },
  // the cultivation life's parts, by address only too (#/gallery/life): a tab would change every section's picture
  { id: 'life', label: '修仙', body: LifeSection },
  // and its clocks, fight, gate and 悟得 (#/gallery/life2), apart so the first section's picture stays
  { id: 'life2', label: '修仙二', body: LifeMoreSection },
  // and 去处, the secret realm and 丹毒 (#/gallery/life3)
  { id: 'life3', label: '修仙三', body: LifePlacesSection },
  // and 主线, the reasons on the commands and 接下来 (#/gallery/life4)
  { id: 'life4', label: '修仙四', body: LifeNextSection },
  // and the book: the 回 and 回目 on the marks, a volume's page, 出关见闻 and 目录 (#/gallery/life5)
  { id: 'life5', label: '修仙五', body: LifeBookSection },
] as const;

/** The sections reached by their address alone, without a tab. */
const UNLISTED: readonly string[] = ['panels', 'life', 'life2', 'life3', 'life4', 'life5'];

const PanelHarness = lazy(() => import('../sheets/Harness'));

type Show = Light | 'both';

function Pane({ light, children }: { light: Light; children: ReactNode }) {
  return (
    <section className={styles.pane} data-light={light} aria-label={light === 'night' ? '夜' : '昼'}>
      <h2 className={styles.paneTitle}>{light === 'night' ? '夜' : '昼'}</h2>
      {children}
    </section>
  );
}

function SheetDemo() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <div className={styles.behind}>
        <Btn onClick={() => setOpen(true)}>打开角色</Btn>
      </div>
      <Sheet title="角色" open={open} onClose={() => setOpen(false)} onBack={() => setOpen(false)}>
        <Sub>根基</Sub>
        <KV
          items={[
            { label: '境界', value: '炼气十三层' },
            { label: '修为', value: '96 / 100' },
            { label: '寿元', value: '27 / 100' },
            { label: '灵根', value: '真灵根 ×1.0' },
          ]}
        />
        <Sub>属性</Sub>
        <KV
          items={[
            { label: '物攻', value: 38, delta: '+5' },
            { label: '物防', value: 33, delta: '+3' },
            { label: '脚力', value: 31 },
            { label: '法攻', value: 39, delta: '+4' },
            { label: '法防', value: 31 },
            { label: '神识', value: 6 },
            { label: '气运', value: 6 },
            { label: '魅力', value: 5 },
          ]}
        />
        <Sub>装备</Sub>
        <SlotGrid>
          {sample.equipment.map((thing, index) => (
            <Slot key={index} thing={thing} emptyLabel="法宝" />
          ))}
        </SlotGrid>
      </Sheet>
    </>
  );
}

function DialogDemo() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <div className={styles.behind}>
        <Btn onClick={() => setOpen(true)}>回到此处</Btn>
      </div>
      <Dialog
        open={open}
        title="回到第三十五回"
        confirmLabel="回到此处"
        danger
        onConfirm={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      >
        <p>会作废之后的 2 个回合，这两回合里的所得所失都不再算数。</p>
      </Dialog>
    </>
  );
}

export default function Gallery({ section }: { section?: string }) {
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  const pinned = pins().light;
  const [show, setShow] = useState<Show>(pinned ?? 'both');
  const setLight = useUiStore((s) => s.setLight);

  useEffect(() => {
    if (show !== 'both') setLight(show);
  }, [show, setLight]);
  useReady(current.id !== 'panels');

  const Body = current.body;
  return (
    <div className={styles.gallery} data-shot-scroll="">
      <header className={styles.head}>
        <h1 className={styles.title}>部件</h1>
        <Tabs
          label="部件的分组"
          items={SECTIONS.filter(({ id }) => !UNLISTED.includes(id)).map(({ id, label }) => ({ id, label }))}
          value={current.id}
          onChange={(id) => navigate({ name: 'gallery', section: id })}
        />
        {!pinned && (
          <div className={styles.switch} role="group" aria-label="颜色">
            {(['both', 'night', 'day'] as Show[]).map((value) => (
              <Btn key={value} variant={show === value ? 'solid' : 'line'} onClick={() => setShow(value)}>
                {{ both: '并排', night: '夜', day: '昼' }[value]}
              </Btn>
            ))}
          </div>
        )}
      </header>
      {Body ? (
        <div className={styles.panes} data-show={show}>
          {show !== 'day' && (
            <Pane light="night">
              <Body />
            </Pane>
          )}
          {show !== 'night' && (
            <Pane light="day">
              <Body />
            </Pane>
          )}
        </div>
      ) : current.id === 'panels' ? (
        <PanelHarness />
      ) : current.id === 'sheet' ? (
        <SheetDemo />
      ) : (
        <DialogDemo />
      )}
    </div>
  );
}
