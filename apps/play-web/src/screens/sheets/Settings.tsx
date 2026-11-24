// 设置 (plan item 47; spec 七, 设置): the account in accounts mode (item 68, account/AccountSection.tsx),
// model connections, how the page looks and moves, the four sound
// buses; the old page's own settings, shared with it: the standing note, world and plot evolution, the
// daily paper, memory and biographies; rebuilding a save's memory, and who made this. Every change
// takes effect at once and is kept: the display and sound in this browser, the rest on the server.
// The help under each background job says what it costs: the extra model calls it makes.
import { useCallback, useEffect, useRef, useState } from 'react';
import { version } from '../../../package.json';
import { audio, BUS_NAMES, type BusName, type BusSettings } from '../../audio';
import { play } from '../../api/client';
import type {
  BiographySettings,
  EvolutionSettings,
  MemorySettings,
  PaperSettings,
  PlaySettings,
  PlotSettings,
} from '../../contracts';
import { type Measure, type Motion, type Quality, useSettingsStore } from '../../store/settings';
import { useUiStore } from '../../store/ui';
import { Btn } from '../../ui/Btn';
import { Loading } from '../../ui/Loading';
import { Sub } from '../../ui/Sub';
import { PHONE, useMedia } from '../../ui/useMedia';
import { useTurnBusy } from './act';
import { useAim } from './aim';
import { Choice, ON_OFF, Row, Slider } from './SettingsControls';
import { licenceGroups, refusal } from './SettingsData';
import { AccountSection } from '../account/AccountSection';
import { LinkSection } from './SettingsLink';
import common from './common.module.css';
import styles from './Settings.module.css';

const MOTIONS: readonly { id: Motion; label: string }[] = [
  { id: 'full', label: '全' },
  { id: 'weak', label: '弱' },
  { id: 'off', label: '关' },
];
const QUALITIES: readonly { id: Quality; label: string }[] = [
  { id: 'auto', label: '自动' },
  { id: 'high', label: '高' },
  { id: 'low', label: '低' },
];
const MEASURES: readonly { id: Measure; label: string }[] = [
  { id: 'narrow', label: '窄' },
  { id: 'normal', label: '中' },
  { id: 'wide', label: '宽' },
];
const BUS_LABEL: Record<BusName, string> = { master: '总音量', music: '配乐', ambience: '环境', sfx: '音效' };
const PAPER_FREQUENCIES: readonly { id: PaperSettings['frequency']; label: string }[] = [
  { id: 'always', label: '每回合' },
  { id: 'rounds', label: '隔几回合' },
  { id: 'daily', label: '每天' },
];
/** The story's size when the setting is left alone: the spec's 17 px, 16.5 on phones. */
const DEFAULT_SIZE = { desktop: 17, phone: 16.5 };
const NOTE_LIMIT = 2000;
/** A slider's value is sent this long after it stops moving. */
const SETTLE_MS = 500;
/** The sliders of 「每 N 回合」 reach this far; a larger value kept on the server still shows as it is. */
const EVERY_MAX = 50;

type Save = (patch: PlaySettings) => Promise<boolean>;

function DisplaySection() {
  const phone = useMedia(PHONE);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const motion = useSettingsStore((s) => s.motion);
  const quality = useSettingsStore((s) => s.quality);
  const measure = useSettingsStore((s) => s.measure);
  const haptics = useSettingsStore((s) => s.haptics);
  const change = useSettingsStore((s) => s.change);
  const reduced = useMedia('(prefers-reduced-motion: reduce)');
  const shown = fontSize ?? (phone ? DEFAULT_SIZE.phone : DEFAULT_SIZE.desktop);
  return (
    <section className={common.section} aria-labelledby="settings-display">
      <Sub id="settings-display">显示</Sub>
      <Row label="正文字号" value={`${shown} px`} wide>
        <div className={styles.sliderRow}>
          <Slider
            label="正文字号"
            value={shown}
            min={15}
            max={20}
            step={0.5}
            valueText={`${shown} 像素`}
            onChange={(size) => change({ fontSize: size })}
          />
          <Btn disabled={fontSize === null} onClick={() => change({ fontSize: null })}>
            默认
          </Btn>
        </div>
      </Row>
      {!phone && (
        <Row label="行宽" hint="书页的宽度；手机上书页总是铺满屏宽。">
          <Choice label="行宽" options={MEASURES} value={measure} onChange={(next) => change({ measure: next })} />
        </Row>
      )}
      <Row
        label="动效"
        hint={
          reduced
            ? '系统开着「减少动态效果」：演出按「弱」来，只留淡入淡出；关：直接跳到结果。'
            : '弱：只留淡入淡出；关：演出直接跳到结果。'
        }
      >
        <Choice label="动效" options={MOTIONS} value={motion} onChange={(next) => change({ motion: next })} />
      </Row>
      <Row label="画质" hint="低：画面用半尺寸的图层和较低的分辨率，省电省流量。">
        <Choice label="画质" options={QUALITIES} value={quality} onChange={(next) => change({ quality: next })} />
      </Row>
      <Row label="震动" hint="落印和突破时手机轻震一下（安卓）。">
        <Choice label="震动" options={ON_OFF} value={haptics ? 'on' : 'off'} onChange={(next) => change({ haptics: next === 'on' })} />
      </Row>
    </section>
  );
}

function SoundSection() {
  const [buses, setBuses] = useState<BusSettings>(() => audio.buses());
  useEffect(() => audio.onBusesChange(setBuses), []);
  return (
    <section className={common.section} aria-labelledby="settings-sound">
      <Sub id="settings-sound">声音</Sub>
      {BUS_NAMES.map((name) => {
        const bus = buses[name];
        const percent = Math.round(bus.volume * 100);
        return (
          <Row key={name} label={BUS_LABEL[name]} value={bus.on ? `${percent}` : '关'} wide>
            <div className={styles.sliderRow}>
              <Slider
                label={BUS_LABEL[name]}
                value={percent}
                min={0}
                max={100}
                valueText={`${percent}`}
                disabled={!bus.on}
                onChange={(value) => audio.setBus(name, { volume: value / 100 })}
              />
              <Choice
                label={`${BUS_LABEL[name]}开关`}
                options={ON_OFF}
                value={bus.on ? 'on' : 'off'}
                onChange={(next) => audio.setBus(name, { on: next === 'on' })}
              />
            </div>
          </Row>
        );
      })}
    </section>
  );
}

/** The settings both interfaces share (GET/PUT /settings): the standing note, evolution, the daily
 * paper, memory and biographies. A write answers with all of them as now kept. */
function useShared() {
  const [shared, setShared] = useState<PlaySettings | null>(null);
  const [error, setError] = useState('');
  // Writes go one after another, each shown at once: two quick changes to one group (日报 on, then
  // 隔几回合) must reach the server in order, and the second must carry the first.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const waiting = useRef(0);
  const load = useCallback(() => {
    setError('');
    play.settings().then(setShared, (problem: unknown) => setError(refusal(problem)));
  }, []);
  useEffect(load, [load]);
  const save = useCallback(
    (patch: PlaySettings): Promise<boolean> => {
      setShared((now) => (now ? { ...now, ...patch } : now));
      waiting.current += 1;
      const run = queue.current.then(async () => {
        try {
          const kept = await play.saveSettings(patch);
          waiting.current -= 1;
          // the last answer is the server's word on every group; earlier ones would undo later changes
          if (waiting.current === 0) setShared(kept);
          return true;
        } catch (problem) {
          waiting.current -= 1;
          useUiStore.getState().notify(refusal(problem), 'error');
          if (waiting.current === 0) load();
          return false;
        }
      });
      queue.current = run;
      return run;
    },
    [load],
  );
  return { shared, error, load, save };
}

function NoteSection({ note, save }: { note: string; save: (patch: PlaySettings) => Promise<boolean> }) {
  const notify = useUiStore((s) => s.notify);
  const [draft, setDraft] = useState(note);
  const [saving, setSaving] = useState(false);
  const changed = draft.trim() !== note.trim();
  const keep = async () => {
    if (!changed || saving) return;
    setSaving(true);
    if (await save({ standingNote: draft.trim() })) notify(draft.trim() ? '常驻指示已保存，下一回合起带上。' : '常驻指示已清空。');
    setSaving(false);
  };
  return (
    <section className={common.section} aria-labelledby="settings-note">
      <Sub id="settings-note">常驻指示</Sub>
      <p className={styles.note}>每回合都随你的行动一起交给模型的一段话。</p>
      <textarea
        className={styles.textarea}
        aria-labelledby="settings-note"
        value={draft}
        maxLength={NOTE_LIMIT}
        rows={4}
        placeholder="比如：多写一些环境和天气；对白简短些。"
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={() => void keep()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void keep();
        }}
      />
      <div className={common.actions}>
        <Btn variant="solid" disabled={!changed || saving} onClick={() => void keep()}>
          {saving ? '保存中……' : '保存'}
        </Btn>
        {changed && <span className={styles.note}>还没保存</span>}
      </div>
    </section>
  );
}

interface EveryProps {
  /** the job, as the slider is read out: 「世界演化」 → 「世界演化的频率」 */
  job: string;
  /** the row's name */
  name?: string;
  value: number;
  /** what happens each time: 「推演一次」 */
  what: string;
  disabled?: boolean;
  onSend: (value: number) => void;
}

/** 「每 N 回合」: a slider whose value is sent once it stops moving, or when the player lets go. */
function EveryRow({ job, name = '频率', value, what, disabled, onSend }: EveryProps) {
  const [shown, setShown] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(onSend);
  useEffect(() => {
    latest.current = onSend;
  });
  useEffect(() => setShown(value), [value]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const send = (next: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (next !== value) latest.current(next);
  };
  return (
    <Row label={name} value={`每 ${shown} 回合`} wide>
      <Slider
        label={`${job}的${name}`}
        value={Math.min(shown, EVERY_MAX)}
        min={1}
        max={EVERY_MAX}
        valueText={`每 ${shown} 回合${what}`}
        disabled={disabled}
        onChange={(next) => {
          setShown(next);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => send(next), SETTLE_MS);
        }}
        onCommit={send}
      />
    </Row>
  );
}

/** A background job's switch, with what it does and what it costs under it. */
function SwitchRow({ label, on, hint, onChange }: { label: string; on: boolean; hint: string; onChange: (on: boolean) => void }) {
  return (
    <Row label={label} hint={hint}>
      <Choice label={label} options={ON_OFF} value={on ? 'on' : 'off'} onChange={(next) => onChange(next === 'on')} />
    </Row>
  );
}

interface EvolutionProps {
  evolution: EvolutionSettings;
  plot?: PlotSettings;
  /** false while the server does not run plot evolution: the switch is kept but does nothing yet */
  plotRuns?: boolean;
  save: Save;
}

function EvolutionSection({ evolution, plot, plotRuns, save }: EvolutionProps) {
  return (
    <section className={common.section} aria-labelledby="settings-evolution">
      <Sub id="settings-evolution">演化</Sub>
      <SwitchRow
        label="世界演化"
        on={evolution.enabled}
        hint="每隔几回合，在后台推演天下大事和人物的动向，写进「世界」的大事和见闻。每次推演多一次模型调用。"
        onChange={(enabled) => void save({ evolution: { ...evolution, enabled } })}
      />
      <EveryRow
        job="世界演化"
        value={evolution.frequency}
        what="推演一次"
        disabled={!evolution.enabled}
        onSend={(frequency) => void save({ evolution: { ...evolution, frequency } })}
      />
      {plot && (
        <>
          <SwitchRow
            label="剧情演化"
            on={plot.enabled}
            hint="每隔几回合，在后台推演主线和伏笔，交给下一回合的模型参考。每次推演多一次模型调用。"
            onChange={(enabled) => void save({ plot: { ...plot, enabled } })}
          />
          {plotRuns === false && (
            <p className={styles.note} role="note">
              剧情演化暂不进行：「世界与剧情演化」用的模型还没通过调用工具的检验。开关先记下，换上检验过的模型后才起作用。
            </p>
          )}
          <EveryRow
            job="剧情演化"
            value={plot.frequency}
            what="推演一次"
            disabled={!plot.enabled}
            onSend={(frequency) => void save({ plot: { ...plot, frequency } })}
          />
        </>
      )}
    </section>
  );
}

function PaperSection({ paper, save }: { paper: PaperSettings; save: Save }) {
  const put = (change: Partial<PaperSettings>) => void save({ paper: { ...paper, ...change } });
  return (
    <section className={common.section} aria-labelledby="settings-paper">
      <Sub id="settings-paper">日报</Sub>
      <SwitchRow
        label="自动写日报"
        on={paper.enabled}
        hint="回合写完后，在后台写一期世界日报，登在「世界」的见闻里。每期多一次模型调用。"
        onChange={(enabled) => put({ enabled })}
      />
      <Row label="频率" hint={paper.frequency === 'daily' ? '游戏里过了一天，才写下一期。' : undefined}>
        <Choice
          label="日报的频率"
          options={PAPER_FREQUENCIES}
          value={paper.frequency}
          disabled={!paper.enabled}
          onChange={(frequency) => put({ frequency })}
        />
      </Row>
      {paper.frequency === 'rounds' && (
        <EveryRow
          job="日报"
          name="间隔"
          value={paper.rounds}
          what="写一期"
          disabled={!paper.enabled}
          onSend={(rounds) => put({ rounds })}
        />
      )}
      <SwitchRow
        label="摘要进提示词"
        on={paper.intoPrompt}
        hint="把最近一期日报的摘要带进下一回合的提示词。不多调用模型，提示词长一些。"
        onChange={(intoPrompt) => put({ intoPrompt })}
      />
    </section>
  );
}

interface MemoryProps {
  saveId: string;
  memory?: MemorySettings;
  biographies?: BiographySettings;
  save: Save;
}

function MemorySection({ saveId, memory, biographies, save }: MemoryProps) {
  const notify = useUiStore((s) => s.notify);
  const busy = useTurnBusy();
  const [working, setWorking] = useState(false);
  const rebuild = async () => {
    // no save to rebuild (the title's settings with no save yet): nothing goes, not even to /saves//
    if (!saveId) return;
    setWorking(true);
    try {
      const { jobs } = await play.rebuildMemory(saveId);
      notify(jobs > 0 ? `记忆已重建，重算了 ${jobs} 条。` : '记忆已重建，这个存档还没有记忆。');
    } catch (problem) {
      notify(refusal(problem), 'error', () => void rebuild());
    } finally {
      setWorking(false);
    }
  };
  return (
    <section className={common.section} aria-labelledby="settings-memory">
      <Sub id="settings-memory">记忆</Sub>
      {memory && (
        <>
          <SwitchRow
            label="自动归档"
            on={memory.archive}
            hint="每隔几回合，把这几回合的故事存进记忆库，日后想得起来。每次归档多一次模型调用，另加向量嵌入。"
            onChange={(archive) => void save({ memory: { ...memory, archive } })}
          />
          <EveryRow
            job="自动归档"
            value={memory.frequency}
            what="归档一次"
            disabled={!memory.archive}
            onSend={(frequency) => void save({ memory: { ...memory, frequency } })}
          />
          <SwitchRow
            label="自动召回"
            on={memory.recall}
            hint="每回合开始前，从记忆库里找出相关的往事写进提示词。每回合多一次向量嵌入，提示词长一些。"
            onChange={(recall) => void save({ memory: { ...memory, recall } })}
          />
        </>
      )}
      {biographies && (
        <SwitchRow
          label="人物传记"
          on={biographies.enabled}
          hint="给遇见的人各记一份档案，在「世界」的档案里；提到他们时写进提示词。不多调用模型，提示词长一些。"
          onChange={(enabled) => void save({ biographies: { enabled } })}
        />
      )}
      <p className={styles.note}>
        重建记忆：用现在的向量模型，把这个存档已有的记忆重新算一遍。换了向量模型之后用；只重算，不归档新的回合。
      </p>
      <div className={common.actions}>
        <Btn disabled={working || busy || !saveId} onClick={() => void rebuild()}>
          {working ? '重建中……' : '重建记忆'}
        </Btn>
        {/* the title's settings with no save to go on with: it posted to /saves//memory/rebuild (the
            documents pass, #18) */}
        {!saveId ? (
          <span className={styles.note}>还没有存档，没有记忆可重建。</span>
        ) : (
          busy && <span className={styles.note}>回合写完之后才能重建。</span>
        )}
      </div>
    </section>
  );
}

function AboutSection({ opened = false }: { opened?: boolean }) {
  const [open, setOpen] = useState(opened);
  const groups = open ? licenceGroups() : [];
  return (
    <section className={common.section} aria-labelledby="settings-about">
      <Sub id="settings-about">关于</Sub>
      <dl className={common.rows}>
        <div>
          <dt>版本</dt>
          <dd>{version}</dd>
        </div>
        <div>
          <dt>作者</dt>
          <dd>andrewwang</dd>
        </div>
      </dl>
      <div className={common.actions}>
        <Btn aria-expanded={open} aria-controls="settings-licences" onClick={() => setOpen(!open)}>
          {open ? '收起第三方许可' : '第三方许可'}
        </Btn>
      </div>
      {open && (
        <div id="settings-licences" className={styles.licences}>
          {groups.map((group) => (
            <div key={`${group.title}-${group.note ?? ''}`} className={styles.licenceGroup}>
              <strong>{group.title}</strong>
              {group.note && <span className={styles.note}>{group.note}</span>}
              <ul>
                {group.items.map((item) => (
                  <li key={item.name}>
                    <span>{item.name}</span>
                    {item.version && <span className={styles.licenceVersion}>{item.version}</span>}
                    <em>{item.licence}</em>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function Settings({ saveId }: { saveId: string }) {
  const { shared, error, load, save } = useShared();
  // the panel may open on a model connection or on the licences (the screenshot page)
  const aim = useAim('settings');
  return (
    <>
      {/* who is signed in and the day's usage, first; nothing in local mode (plan item 68) */}
      <AccountSection />
      <section className={common.section} aria-labelledby="settings-link">
        <Sub id="settings-link">模型连接</Sub>
        <LinkSection opened={aim?.pick} />
      </section>
      <DisplaySection />
      <SoundSection />
      {error ? (
        <div className={styles.failed} role="alert">
          <span>常驻指示、演化、日报和记忆的设置没能读到：{error}</span>
          <Btn onClick={load}>重试</Btn>
        </div>
      ) : !shared ? (
        <Loading text="读取设置……" />
      ) : (
        <>
          <NoteSection note={shared.standingNote ?? ''} save={save} />
          <EvolutionSection
            evolution={shared.evolution ?? { enabled: false, frequency: 1 }}
            plot={shared.plot}
            plotRuns={shared.plotRuns}
            save={save}
          />
          {/* a group the server did not send is one it cannot keep yet: its rows stay away */}
          {shared.paper && <PaperSection paper={shared.paper} save={save} />}
        </>
      )}
      <MemorySection saveId={saveId} memory={shared?.memory} biographies={shared?.biographies} save={save} />
      <AboutSection opened={aim?.pick === 'licences'} />
    </>
  );
}
