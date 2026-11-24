// 冲关准备单 (gameplay plan item 24; the mock-up's .fx-hero, .fx-have, .fx-prep, .fx-go): the next gate as
// the engine sees it (GET …/gate). On top the odds in large brush and the foundation an attempt now would
// leave, with the formula; the hard requirements with 齐 or 缺; what can be prepared with 有 (cinnabar),
// 可 (a gold frame) or 缺 (dashed); at the foot 「冲关」, gilded, and 「再备一备」, which closes the sheet.
// 「冲关」 first asks which pills to take (the sheet prices them again), then confirms, then sends
// verb { kind: 'breakthrough', aids }; the attempt plays as the breakthrough performance does. On phones
// the two buttons stand at the sheet's foot and its middle scrolls.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, play } from '../../api/client';
import type { GatePreparation, GateRequirement, GateSheet, Item } from '../../contracts';
import { chineseNumber } from '../../lib/numerals';
import { useStateStore } from '../../store/state';
import { useTurnsStore } from '../../store/turns';
import { useUiStore } from '../../store/ui';
import { oddsWords } from '../../ui/Acts';
import { Dialog } from '../../ui/Dialog';
import { Loading } from '../../ui/Loading';
import { Sub } from '../../ui/Sub';
import { sendCommand } from '../play/commands';
import styles from './Gate.module.css';

const two = (n: number) => (n === 2 ? '两' : chineseNumber(n));

/** The seal of a preparation: 有 可 缺; for 心结, having none is 无 and having some is 有 (dashed). */
export function prepSeal(prep: GatePreparation): { glyph: string; look: 'ok' | 'can' | 'no' } {
  if (prep.key === 'knots') return prep.state === 'have' ? { glyph: '无', look: 'ok' } : { glyph: '有', look: 'no' };
  if (prep.state === 'have') return { glyph: '有', look: 'ok' };
  return prep.state === 'can' ? { glyph: '可', look: 'can' } : { glyph: '缺', look: 'no' };
}

/** 「再备一样到稳固」 */
export function nextWords(sheet: GateSheet): string {
  const next = sheet.foundation?.next;
  return next ? `再备${next.need === 1 ? '一' : two(next.need)}样到${next.grade}。` : '';
}

/** The gate's pills in the bag: the items whose names the 丹药 row names (「筑基丹」). */
export function pillsFor(sheet: GateSheet | null, bag: readonly Item[]): Item[] {
  const row = sheet?.prepares.find((prep) => prep.key === 'aids');
  if (!row) return [];
  const names = row.label.split('、').filter(Boolean);
  return bag.filter((item) => item.quantity > 0 && names.some((name) => item.name.includes(name)));
}

/** Bag ids, one a pill: { I1: 2 } → ['I1', 'I1']. */
export function aidsOf(counts: Readonly<Record<string, number>>): string[] {
  return Object.entries(counts).flatMap(([id, count]) => Array.from({ length: Math.max(0, count) }, () => id));
}

function Requirement({ need }: { need: GateRequirement }) {
  return (
    <div className={styles.need}>
      <i className={styles.seal} data-look={need.met ? 'ok' : 'no'}>
        {need.met ? '齐' : '缺'}
      </i>
      <p>
        <b>{need.label}</b>
        <small>{need.text}</small>
      </p>
    </div>
  );
}

function Preparation({ prep }: { prep: GatePreparation }) {
  const seal = prepSeal(prep);
  return (
    <li className={styles.prep}>
      <i className={styles.seal} data-look={seal.look}>
        {seal.glyph}
      </i>
      <b>{prep.label}</b>
      <span>{prep.text}</span>
      {prep.odds ? <u data-dim={prep.state === 'have' ? undefined : ''}>+{prep.odds}</u> : null}
    </li>
  );
}

/** The odds, the foundation and the formula: what an attempt now would be. */
export function GateHero({ sheet }: { sheet: GateSheet }) {
  return (
    <div className={styles.hero}>
      <div className={styles.big}>
        <i>成算</i>
        <b>{oddsWords(sheet.odds)}</b>
      </div>
      <p>
        {sheet.foundation && (
          <strong>
            <em>根基</em>
            {sheet.foundation.grade}
          </strong>
        )}
        {sheet.formula ? `${sheet.formula}。` : ''}
        {nextWords(sheet)}
      </p>
    </div>
  );
}

/** Which pills to take: one stepper a stack, as many as the bag holds; the sheet prices them again. */
function Pills({
  pills,
  counts,
  onCount,
}: {
  pills: Item[];
  counts: Readonly<Record<string, number>>;
  onCount: (id: string, count: number) => void;
}) {
  return (
    <ul className={styles.pills}>
      {pills.map((item) => {
        const count = counts[item.id] ?? 0;
        return (
          <li key={item.id} className={styles.pill}>
            <b>{item.name}</b>
            <small>持有 {item.quantity}</small>
            <span className={styles.stepper} role="group" aria-label={`服几枚${item.name}`}>
              <button type="button" aria-label={`少服一枚${item.name}`} disabled={count <= 0} onClick={() => onCount(item.id, count - 1)}>
                −
              </button>
              <output aria-live="polite">{count}</output>
              <button type="button" aria-label={`多服一枚${item.name}`} disabled={count >= item.quantity} onClick={() => onCount(item.id, count + 1)}>
                +
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function GatePanel({ saveId }: { saveId: string }) {
  const view = useStateStore((s) => s.view);
  const closeSheet = useUiStore((s) => s.closeSheet);
  const busy = useTurnsStore((s) => s.live?.status === 'streaming' || s.live?.status === 'pending');
  const [sheet, setSheet] = useState<GateSheet | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [step, setStep] = useState<'sheet' | 'pills'>('sheet');
  const [asking, setAsking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const pills = useMemo(() => pillsFor(sheet, view?.bag ?? []), [sheet, view?.bag]);
  const aids = aidsOf(counts);
  // the pills asked about: none at the sheet (the bag's, as many as count), and at the pills step the ones
  // chosen, none too when every count is down to zero (the documents pass, #19: asked without pills then,
  // the sheet counted the bag's and showed higher odds than the attempt, which takes none, would roll)
  const asked = step === 'pills' ? aids.join(',') : null;
  const needsId = useId();
  const prepsId = useId();
  const first = useRef(true);

  // the sheet, and again with the pills chosen (once a choice rests)
  useEffect(() => {
    const stop = new AbortController();
    setAsking(true);
    const timer = setTimeout(
      () =>
        void play.gate(saveId, asked === null ? undefined : asked ? asked.split(',') : [], stop.signal).then(
          (answer) => {
            if (stop.signal.aborted) return;
            setSheet(answer);
            setProblem(null);
            setAsking(false);
          },
          (error: unknown) => {
            if (stop.signal.aborted) return;
            setProblem(error instanceof ApiError ? error.message : '准备单没能取来，稍后再试。');
            setAsking(false);
          },
        ),
      first.current ? 0 : 150,
    );
    first.current = false;
    return () => {
      clearTimeout(timer);
      stop.abort();
    };
  }, [saveId, asked]);

  if (problem && !sheet) {
    return (
      <p className={styles.problem} role="alert">
        {problem}
      </p>
    );
  }
  if (!sheet) return <Loading text="铺开命盘……" />;
  if (sheet.beyond) return <p className={styles.beyond}>{sheet.text ?? '此路未开'}</p>;

  const inScene = Boolean(view?.play?.scene || view?.play?.fight);
  const blocked = !sheet.ready ? (sheet.missing[0] ?? '还没到冲关的时候') : busy ? '这一回合写完之后才能冲关' : inScene ? '这场戏还没收场' : null;
  const days = sheet.days ? `耗${two(sheet.days)}日` : '';

  const begin = () => {
    if (blocked) return;
    if (pills.length === 0) {
      setConfirming(true);
      return;
    }
    // as many as the bag holds: the engine takes the most that count, the rest it leaves
    setCounts(Object.fromEntries(pills.map((item) => [item.id, item.quantity])));
    setStep('pills');
  };
  const attempt = () => {
    setConfirming(false);
    if (sendCommand({ verb: { kind: 'breakthrough', ...(aids.length ? { aids } : {}) } })) closeSheet();
  };
  const taken = pills
    .filter((item) => (counts[item.id] ?? 0) > 0)
    .map((item) => `${item.name}${two(counts[item.id] ?? 0)}枚`)
    .join('、');

  return (
    <div className={styles.gate} data-step={step}>
      <div className={styles.middle}>
        <GateHero sheet={sheet} />
        {step === 'sheet' ? (
          <>
            <section className={styles.part} aria-labelledby={needsId}>
              <Sub id={needsId}>硬条件</Sub>
              <div className={styles.needs}>
                {sheet.requires.map((need) => (
                  <Requirement key={need.key} need={need} />
                ))}
              </div>
            </section>
            <section className={styles.part} aria-labelledby={prepsId}>
              <Sub id={prepsId}>能备的</Sub>
              <ul className={styles.preps}>
                {sheet.prepares.map((prep) => (
                  <Preparation key={prep.key} prep={prep} />
                ))}
              </ul>
            </section>
            {sheet.cooldown && <p className={styles.reason}>{sheet.cooldown.text}之前不能再冲关。</p>}
          </>
        ) : (
          <section className={styles.part} aria-labelledby={prepsId} aria-busy={asking}>
            <Sub id={prepsId}>服哪几枚</Sub>
            <Pills pills={pills} counts={counts} onCount={(id, count) => setCounts((before) => ({ ...before, [id]: count }))} />
            <p className={styles.note}>{sheet.prepares.find((prep) => prep.key === 'aids')?.text}</p>
          </section>
        )}
      </div>
      <div className={styles.go}>
        {step === 'sheet' ? (
          <>
            <button type="button" className={styles.main} aria-disabled={blocked ? true : undefined} onClick={begin}>
              <span>冲关</span>
              <small>{blocked ?? days}</small>
            </button>
            <button type="button" onClick={closeSheet}>
              <span>再备一备</span>
              <small>合上准备单</small>
            </button>
          </>
        ) : (
          <>
            <button type="button" className={styles.main} aria-disabled={asking || undefined} onClick={() => !asking && setConfirming(true)}>
              <span>冲关</span>
              <small>{days}</small>
            </button>
            <button type="button" onClick={() => setStep('sheet')}>
              <span>回到准备单</span>
              <small>先不冲</small>
            </button>
          </>
        )}
      </div>
      {/* over the whole screen: the sheet's frame would hold a fixed layer inside itself */}
      {createPortal(
        <Dialog
          open={confirming}
          title={`冲关「${sheet.name}」`}
          confirmLabel="冲关"
          cancelLabel="再想想"
          onConfirm={attempt}
          onCancel={() => setConfirming(false)}
        >
          <p>
            {taken ? `服${taken}，` : '不服丹药，'}成算{oddsWords(sheet.odds)}
            {sheet.foundation ? `，根基${sheet.foundation.grade}` : ''}。{days ? `${days}。` : ''}冲关不成，要歇一阵才能再冲。
          </p>
        </Dialog>,
        document.body,
      )}
    </div>
  );
}
