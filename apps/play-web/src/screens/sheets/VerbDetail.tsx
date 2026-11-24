// What a panel of the cultivation life ends in when it ends in a command (洞府's doings, 布阵, a teleport
// array's crossing and its errand; gameplay plan items 45 and 43): a title, what can be chosen, the command's
// preview (POST …/preview, the same answer the turn would settle) and the button that sends it as the
// turn's verb, saying why it cannot go now; 看别的 goes back to the panel.
import { type CSSProperties, type ReactNode, useId } from 'react';
import type { Verb } from '../../contracts';
import { useStateStore } from '../../store/state';
import { useTurnsStore } from '../../store/turns';
import { useUiStore } from '../../store/ui';
import { Act } from '../../ui/Act';
import { Btn } from '../../ui/Btn';
import { Loading } from '../../ui/Loading';
import { sendCommand } from '../play/commands';
import { Preview, spanWords } from './Cultivate';
import days from './Cultivate.module.css';
import shop from './Shop.module.css';
import { usePreview } from './usePreview';
import styles from './VerbDetail.module.css';

export interface VerbDetailProps {
  saveId: string;
  /** the command as it stands with what is chosen: asked again whenever it changes */
  verb: Verb;
  /** the title in brush, and the small words beside it */
  title: string;
  sub?: string;
  /** the button: the glyph in its diamond and its name (「买下」「布阵」) */
  glyph: string;
  name: string;
  /** what is chosen before the preview: a room, an herb and how many, an array and its disc */
  children?: ReactNode;
  onBack: () => void;
}

export function VerbDetail({ saveId, verb, title, sub, glyph, name, children, onBack }: VerbDetailProps) {
  const view = useStateStore((s) => s.view);
  const closeSheet = useUiStore((s) => s.closeSheet);
  const busy = useTurnsStore((s) => s.live?.status === 'streaming' || s.live?.status === 'pending');
  const { preview, problem, asking } = usePreview(saveId, verb);
  const inScene = Boolean(view?.play?.scene || view?.play?.fight);
  const ready = Boolean(preview?.ok) && !asking && !busy && !inScene;
  const why = busy
    ? `这一回合写完之后才能${name}。`
    : inScene
      ? '这场戏还没收场。'
      : asking
        ? '推算中……'
        : (problem ?? (preview && !preview.ok ? (preview.reason ?? `眼下${name}不了。`) : preview ? spanWords(preview.minutes) : ''));
  const titleId = useId();
  return (
    <section className={shop.detail} aria-labelledby={titleId}>
      <header className={shop.head}>
        <h3 id={titleId}>{title}</h3>
        {sub && <span>{sub}</span>}
      </header>
      {children}
      <div className={days.preview} aria-label="预览" aria-busy={asking} data-stale={asking && preview ? '' : undefined}>
        {preview ? <Preview preview={preview} kind={verb.kind} /> : !problem ? <Loading text="推算中……" /> : null}
        {problem && (
          <p className={days.reason} role="alert">
            {problem}
          </p>
        )}
      </div>
      <div className={shop.go}>
        <Act
          glyph={glyph}
          name={name}
          note={why}
          hot={ready}
          unavailable={!ready}
          onClick={() => {
            if (ready && sendCommand({ verb })) closeSheet();
          }}
        />
        <Btn onClick={onBack}>看别的</Btn>
      </div>
    </section>
  );
}

/** A labelled grid of options, a finger tall each, the chosen one solid: 「布哪一种」「放几块灵石」. */
export function Options<T extends string>({
  label,
  options,
  value,
  onChange,
  columns = 4,
}: {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  columns?: number;
}) {
  return (
    <fieldset className={styles.options}>
      <legend className={styles.label}>{label}</legend>
      <div className={styles.grid} style={{ '--columns': columns } as CSSProperties}>
        {options.map((option) => (
          <Btn key={option.id} variant={option.id === value ? 'solid' : 'line'} aria-pressed={option.id === value} onClick={() => option.id !== value && onChange(option.id)}>
            {option.label}
          </Btn>
        ))}
      </div>
    </fieldset>
  );
}

/** A line of small words under what is chosen: what an array does, what a room is for. */
export function Said({ children }: { children: ReactNode }) {
  return <p className={styles.text}>{children}</p>;
}

/** A stepper of how many beside its label, 44 px a button: 「种几株」「−」「三株」「+」. */
export function Stepper({ label, value, min, max, unit, onChange }: { label: string; value: number; min: number; max: number; unit: string; onChange: (value: number) => void }) {
  return (
    <div className={styles.field}>
      <span className={styles.label} aria-hidden="true">
        {label}
      </span>
      <Count label={label} value={value} min={min} max={max} unit={unit} onChange={onChange} />
    </div>
  );
}

function Count({ label, value, min, max, unit, onChange }: { label: string; value: number; min: number; max: number; unit: string; onChange: (value: number) => void }) {
  return (
    <div className={shop.count} role="group" aria-label={label}>
      <button type="button" aria-label={`少一${unit}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <output aria-live="polite">
        {value}
        <small>{unit}</small>
      </output>
      <button type="button" aria-label={`多一${unit}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}
