// A piece of gear in the cultivation life (gameplay plan items 33 and 34; play.gear): under a piece's
// detail in the character panel and the bag, what the engine reads of it: its tier and quality, whether it
// counts (and why not), what it gives now, the refining (祭炼) with its bar, the condition, a damage, a
// stolen mark, its traits. Then what can be done to it, each with the preview of doing it (POST …/preview)
// and a 行动钮 sending the verb: 修补 a damaged piece (by hand, or by a smith for stones), else 祭炼 one
// not yet fully refined. The belt (腰带) is a row of five places.
import { useId, useState } from 'react';
import type { BeltThing, GearActive, GearInactive, GearPiece, Item, PlayGear, Verb } from '../../contracts';
import { beltable } from '../../lib/belt';
import { chineseNumber } from '../../lib/numerals';
import { useStateStore } from '../../store/state';
import { useTurnsStore } from '../../store/turns';
import { useUiStore } from '../../store/ui';
import { Act } from '../../ui/Act';
import { Bar } from '../../ui/Bar';
import { Loading } from '../../ui/Loading';
import { sendCommand } from '../play/commands';
import { Preview, spanWords } from './Cultivate';
import days from './Cultivate.module.css';
import { Rows } from './Rows';
import { Choice } from './SettingsControls';
import { usePreview } from './usePreview';
import styles from './GearLife.module.css';

const ROLE: Record<string, string> = { main: '主修', aux: '辅修' };

/** 「物攻 +6、法防 +3」: what a piece that counts gives now, the stats it adds to. */
export function bonusWords(bonus: Record<string, number | undefined>): string {
  return Object.entries(bonus)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] !== 0)
    .map(([stat, value]) => `${stat} ${value > 0 ? '+' : ''}${value}`)
    .join('、');
}

/** The rows of a piece: 品阶, 生效 (or why not), 加成, 成色, 特性. */
export function gearRows(piece: GearPiece, active?: GearActive, inactive?: GearInactive): { label: string; value: string }[] {
  const rows = [{ label: '品阶', value: [piece.tier, piece.quality && `${piece.quality}品`, piece.above && `高${chineseNumber(piece.above)}阶`].filter(Boolean).join(' · ') }];
  if (active) rows.push({ label: '生效', value: active.role ? ROLE[active.role] ?? '生效' : '生效' });
  else if (inactive) rows.push({ label: '生效', value: `不算数：${inactive.reason}` });
  else if (piece.unusable) rows.push({ label: '装备', value: piece.unusable });
  const bonus = active ? bonusWords(active.bonus) : '';
  if (bonus) rows.push({ label: '加成', value: bonus });
  rows.push({ label: '成色', value: piece.condition });
  if (piece.traits.length) rows.push({ label: '特性', value: piece.traits.join('、') });
  return rows;
}

/** What a piece's marks say that holds it back: half until refined, a damage, a stolen mark. */
export function gearNotes(piece: GearPiece): string[] {
  const out: string[] = [];
  if (piece.attune.done < piece.attune.need) out.push(`还没祭炼满，效果只有一半`);
  if (piece.damaged) out.push('受损：效果减半，修好之前一直如此');
  if (piece.stolen) out.push(`赃物：夺自${piece.stolen.owner}${piece.stolen.faction ? `（${piece.stolen.faction}）` : ''}，在那一带用它或卖它会惹事`);
  return out;
}

type Mend = 'hand' | 'smith';

/** The verb a piece's action sends: 修补 a damaged one (by hand or by a smith), else 祭炼. */
export function gearVerb(itemId: string, piece: GearPiece, mend: Mend): Verb | null {
  if (piece.unusable) return null;
  if (piece.damaged) return { kind: 'repair', id: itemId, ...(mend === 'smith' ? { smith: true } : {}) };
  if (piece.attune.done < piece.attune.need) return { kind: 'refine', id: itemId };
  return null;
}

function GearAction({ saveId, itemId, piece }: { saveId: string; itemId: string; piece: GearPiece }) {
  const view = useStateStore((s) => s.view);
  const closeSheet = useUiStore((s) => s.closeSheet);
  const busy = useTurnsStore((s) => s.live?.status === 'streaming' || s.live?.status === 'pending');
  const [mend, setMend] = useState<Mend>('hand');
  const verb = gearVerb(itemId, piece, mend);
  const { preview, problem, asking } = usePreview(saveId, verb);
  if (!verb) return null;
  const name = verb.kind === 'repair' ? '修补' : '祭炼';
  const inScene = Boolean(view?.play?.scene || view?.play?.fight);
  const ready = Boolean(preview?.ok) && !asking && !busy && !inScene;
  const why = busy
    ? `这一回合写完之后才能${name}。`
    : inScene
      ? '这场戏还没收场。'
      : asking
        ? '推算中……'
        : (problem ?? (preview && !preview.ok ? (preview.reason ?? `眼下${name}不了。`) : preview ? spanWords(preview.minutes) : ''));
  return (
    <div className={styles.action}>
      {verb.kind === 'repair' && (
        <Choice
          label="怎么修"
          options={[
            { id: 'hand', label: '自己修' },
            { id: 'smith', label: '找炼器师' },
          ]}
          value={mend}
          onChange={(value) => setMend(value === 'smith' ? 'smith' : 'hand')}
        />
      )}
      <div className={days.preview} aria-label="预览" aria-busy={asking} data-stale={asking && preview ? '' : undefined}>
        {preview ? <Preview preview={preview} kind={verb.kind} /> : !problem ? <Loading text="推算中……" /> : null}
        {problem && (
          <p className={days.reason} role="alert">
            {problem}
          </p>
        )}
      </div>
      <Act
        glyph={verb.kind === 'repair' ? '补' : '炼'}
        name={name}
        note={why}
        hot={ready}
        unavailable={!ready}
        onClick={() => {
          if (ready && sendCommand({ verb })) closeSheet();
        }}
      />
    </div>
  );
}

/** The cultivation life's marks of a piece (worn or in the bag) and what can be done to it; nothing in a
 *  save without play.gear or for a thing that is not a piece. */
export function GearLife({ saveId, itemId, gear }: { saveId: string; itemId: string; gear: PlayGear | undefined }) {
  const piece = gear?.pieces[itemId];
  if (!gear || !piece) return null;
  const active = gear.active.find((each) => each.id === itemId);
  const inactive = gear.inactive.find((each) => each.id === itemId);
  return (
    <div className={styles.life}>
      <Rows rows={gearRows(piece, active, inactive)} />
      <Bar label="祭炼" current={piece.attune.done} max={piece.attune.need} tone="gold" />
      {gearNotes(piece).map((note) => (
        <p key={note} className={styles.note}>
          {note}
        </p>
      ))}
      <GearAction key={itemId} saveId={saveId} itemId={itemId} piece={piece} />
    </div>
  );
}

/** The belt's places after one is set to `itemId` (or emptied): the bag ids in order, the empty ones out. */
export function beltWith(belt: (BeltThing | null)[], at: number, itemId: string | null): string[] {
  const ids = belt.map((thing) => thing?.itemId ?? null);
  ids[at] = itemId;
  return ids.filter((id): id is string => Boolean(id));
}

/** The belt's five places: what 物 can use in a fight. With `onSet` a place pressed lists what the bag
 *  holds that the belt takes (each thing once) and 「空着」; a choice sets the belt (panel action belt). */
export function Belt({
  belt,
  bag = [],
  onSet,
  disabled = false,
}: {
  belt: (BeltThing | null)[];
  bag?: readonly Item[];
  onSet?: (items: string[]) => void;
  disabled?: boolean;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const choicesId = useId();
  const on = new Set(belt.map((thing) => thing?.itemId).filter(Boolean));
  const current = picked === null ? null : (belt[picked] ?? null);
  const offered = bag.filter((item) => beltable(item) && (!on.has(item.id) || item.id === current?.itemId));
  const choose = (itemId: string | null) => {
    if (picked === null || !onSet) return;
    onSet(beltWith(belt, picked, itemId));
    setPicked(null);
  };
  return (
    <>
      <ol className={styles.belt} aria-label="腰带">
        {belt.map((thing, at) => {
          const words = thing ? (
            <>
              <b>{thing.name}</b>
              <span>×{thing.quantity}</span>
            </>
          ) : (
            <span>空</span>
          );
          return (
            <li key={at} data-empty={thing ? undefined : ''}>
              {onSet ? (
                <button
                  type="button"
                  aria-label={`腰带第 ${at + 1} 格：${thing ? `${thing.name} ×${thing.quantity}` : '空着'}`}
                  aria-expanded={picked === at}
                  aria-controls={choicesId}
                  data-picked={picked === at ? '' : undefined}
                  disabled={disabled}
                  onClick={() => setPicked(picked === at ? null : at)}
                >
                  {words}
                </button>
              ) : (
                words
              )}
            </li>
          );
        })}
      </ol>
      {onSet && picked !== null && (
        <div id={choicesId} className={styles.choices} role="group" aria-label={`第 ${picked + 1} 格放什么`}>
          <p>第 {picked + 1} 格放什么</p>
          {offered.length === 0 && !current && <p className={styles.beltNote}>储物袋里没有腰带能放的东西（丹药、符箓、符宝）。</p>}
          <ul>
            {offered.map((item) => (
              <li key={item.id}>
                <button type="button" data-on={item.id === current?.itemId ? '' : undefined} disabled={disabled} onClick={() => choose(item.id)}>
                  <b>{item.name}</b>
                  <span>×{item.quantity}</span>
                </button>
              </li>
            ))}
            {current && (
              <li>
                <button type="button" disabled={disabled} onClick={() => choose(null)}>
                  <b>空着</b>
                  <span>取下{current.name}</span>
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
      <p className={styles.beltNote}>斗法里「物」只用得了腰带上的；{onSet ? '点一格换上储物袋里的丹药、符箓或符宝。' : '腰带放储物袋里最前面的丹药和符箓。'}</p>
    </>
  );
}
