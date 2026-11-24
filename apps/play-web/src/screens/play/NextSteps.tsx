// 接下来 (the first playtest: after a scene the player did not know what to do): at the end of the days
// and under a scene's close card, whenever no scene or fight is on, up to three things to do now that the
// engine reads from the save (view.play.next, apps/engine/life/hints.cjs), the main line's first
// (「主线·市井谋生（灵石 5/20）：揭告示接「青灵草十株」，酬十块」). One with a verb is a button: the page
// sends it or opens what it opens (followStep in PlayPage); one without is words.
import { type ReactNode, useId } from 'react';
import type { PlayHint, PlayVerb, PlayView, Verb } from '../../contracts';
import { Sub } from '../../ui/Sub';
import styles from './NextSteps.module.css';

/** One thing to do now (PlayHint): its words, where it comes from (earn, main, job, clock, event, injury,
 *  cultivate, mind, method, gate, hook, notice, shop, calendar) and the standing command that does it. */
export type NextStep = PlayHint;

/** The things to do now of a state, at most three; none when the engine gives none. */
export function nextOf(play: PlayView | undefined | null): NextStep[] {
  return (play?.next ?? []).filter((step) => Boolean(step?.text)).slice(0, 3);
}

/** A command's character, for one the place does not list now. */
const VERB_GLYPHS: Record<string, string> = {
  cultivate: '修',
  rest: '息',
  wait: '候',
  ask: '探',
  job: '告',
  trade: '市',
  travel: '往',
  gather: '采',
  hunt: '猎',
  craft: '炼',
  breakthrough: '关',
  // 拜访 (content/life/visit.json) and a sect's duty (宗门差事), which the place lists only now and then
  visit: '访',
  duty: '宗',
};

/** Where a thing to do comes from, for one without a command. */
const KIND_GLYPHS: Record<string, string> = {
  clock: '钟',
  event: '事',
  injury: '伤',
  cultivate: '修',
  mind: '心',
  method: '功',
  gate: '关',
  hook: '往',
  notice: '告',
  shop: '市',
  calendar: '历',
};

/** The kinds whose own character goes before their command's: a way to earn (财), how to finish a notice
 *  already taken (差) — whatever command does it (揭告示, 采集, 赶路 …) — and a thread a scene left open (约,
 *  taken up by 接着办). */
const OWN_GLYPHS: Record<string, string> = { earn: '财', job: '差', thread: '约' };

/** The character in a suggestion's diamond: 主 for the main line, 财 and 差 for those kinds, else its
 *  command's, else its kind's. */
export function stepGlyph(step: NextStep, verbs: readonly PlayVerb[] = []): string {
  if (step.kind === 'main') return '主';
  if (OWN_GLYPHS[step.kind]) return OWN_GLYPHS[step.kind]!;
  if (step.verb) return verbs.find((verb) => verb.kind === step.verb?.kind)?.glyph ?? VERB_GLYPHS[step.verb.kind] ?? '行';
  return KIND_GLYPHS[step.kind] ?? '行';
}

export interface NextStepsProps {
  steps: NextStep[];
  /** a suggestion's command pressed */
  onStep: (verb: Verb) => void;
  /** the place's commands, for their characters */
  verbs?: readonly PlayVerb[];
  /** a turn is being written: nothing can be pressed */
  disabled?: boolean;
  /** the main line's and the next gate's cards folded to a line each (NextLine), under the suggestions */
  lines?: ReactNode[];
  /** a quiet line under it all: how to go on from a scene, the first few times one closes */
  note?: string;
}

export function NextSteps({ steps, onStep, verbs = [], disabled = false, lines = [], note }: NextStepsProps) {
  const titleId = useId();
  if (!steps.length && !lines.length && !note) return null;
  return (
    // data-lead: the way on, which the following brings in from its top when a turn is done (useFollow)
    <section className={styles.next} aria-labelledby={titleId} data-lead="">
      <Sub id={titleId}>接下来</Sub>
      {steps.length > 0 && (
        <ol className={styles.steps}>
          {steps.map((step, at) => {
            const inner = (
              <>
                <span className={styles.d} aria-hidden="true" data-mark="">
                  <span>{stepGlyph(step, verbs)}</span>
                </span>
                <span className={styles.text}>{step.text}</span>
              </>
            );
            return (
              <li key={at}>
                {step.verb ? (
                  <button type="button" className={styles.step} data-kind={step.kind} disabled={disabled} onClick={() => step.verb && onStep(step.verb)}>
                    {inner}
                    <i className={styles.go} aria-hidden="true" />
                  </button>
                ) : (
                  <p className={styles.step} data-kind={step.kind}>
                    {inner}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {lines.length > 0 && (
        <ul className={styles.lines} aria-label="主线与下一关">
          {lines}
        </ul>
      )}
      {note && <p className={styles.note}>{note}</p>}
    </section>
  );
}

export interface NextLineProps {
  /** main: the main line's cinnabar seal; gate: the next gate's gold one */
  kind: 'main' | 'gate';
  glyph: string;
  /** the one line: 「主线 · 第三章 · 太南风云」 */
  text: string;
  /** what it stands at, after it (「0/1」, 「成算七成」): kept whole where a narrow screen cuts the words */
  tail?: string;
  /** what a screen reader hears: the card's own words */
  label: string;
  onOpen: () => void;
}

/** A card folded to one line under 接下来 when the turn did not move it: its seal, its words and where it
 *  stands, a chevron; the whole line opens what the card opens (the 任务 panel, the gate's 准备单). */
export function NextLine({ kind, glyph, text, tail, label, onOpen }: NextLineProps) {
  return (
    <li>
      <button type="button" className={styles.step} data-kind={kind} data-line="" aria-label={label} onClick={onOpen}>
        <span className={styles.d} aria-hidden="true" data-mark="">
          <span>{glyph}</span>
        </span>
        <span className={styles.text} aria-hidden="true">
          <span className={styles.words}>{text}</span>
          {tail && (
            <span className={styles.tail} data-tail="">
              {' · '}
              {tail}
            </span>
          )}
        </span>
        <i className={styles.go} aria-hidden="true" />
      </button>
    </li>
  );
}
