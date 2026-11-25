// The story in the 任务 panel of the cultivation life (gameplay plan items 26 and 40; the mock-up
// story-mainline-phone.jpg): the storyline's title and hook, 这一章 (the chapter, its goal and each
// condition with 齐 or 缺), 疑点 (play.leads: the open ones first, each with where to look, a proven one
// sealed 实), 因果 (play.karma: 恩 怨 债 诺, a 诺's day, what is settled and what was broken) and 心结
// (play.knots, each taking one off a gate's odds). A novel's save keeps its own card (Quests.tsx).
import type { Mainline, PlayDate, PlayKarma, PlayKnot, PlayLead } from '../../contracts';
import { Sub } from '../../ui/Sub';
import { dayWords } from '../../lib/book';
import { leadActionLabel } from '../play/commands';
import { clueCount, clueWords } from '../play/MainlineCard';
import styles from './Story.module.css';

type Tone = 'cin' | 'gold' | 'faint';

/** A seal of one brush character: cinnabar, a gold frame, or dashed and faint. */
function Seal({ glyph, tone }: { glyph: string; tone: Tone }) {
  return (
    <span className={styles.seal} data-tone={tone} data-mark="" aria-hidden="true">
      {glyph}
    </span>
  );
}

const KARMA_TONE: Record<PlayKarma['kind'], Tone> = { 恩: 'cin', 诺: 'cin', 怨: 'gold', 债: 'gold' };

/** What a screen reader hears of a ledger entry's state, and what stands at its right. */
export function karmaState(entry: PlayKarma): string {
  if (entry.broken) return '失信';
  if (entry.done) return '已了结';
  return entry.due ? `${entry.due.text}为期` : '';
}

/** The storyline's name and hook, then 这一章: the chapter, its goal and its conditions. */
export function StoryHead({ line, date }: { line: Mainline; date?: PlayDate }) {
  const done = line.clues.filter((clue) => clue.done).length;
  return (
    <>
      <Sub>主线</Sub>
      <section className={styles.chapter}
        aria-label={[line.title, line.chapter].filter(Boolean).join(' · ')}>
        {line.title && <h3 className={styles.storyName}>{line.title}</h3>}
        {line.hook && <p className={styles.hook}>{line.hook}</p>}
        <strong>{line.chapter}</strong>
        {line.goal && <p className={styles.goal}>{line.goal}</p>}
        {line.clues.length > 0 && (
          <ul aria-label={`条件，齐了 ${done} 条，共 ${line.clues.length} 条`}>
            {line.clues.map((clue, at) => (
              <li key={at} data-done={clue.done ? '' : undefined}>
                <Seal glyph={clue.done ? '齐' : clue.pending ? '待' : '缺'}
                  tone={clue.done ? 'cin' : 'faint'} />
                <span>{clue.text}</span>
                {clue.pending && <small className={styles.review} aria-hidden="true">待核验</small>}
                {!clue.done && clueCount(clue) && <b>{clueCount(clue)}</b>}
                <span className="visually-hidden">，{clueWords(clue)}</span>
              </li>
            ))}
          </ul>
        )}
        {date && line.clues.some((clue) => !clue.done && clue.text.startsWith('时间不早于')) && (
          <p className={styles.note}>当前游戏时间为{dayWords(date)}</p>
        )}
        {line.next && <em className={styles.next}>下一章 · {line.next.replace(/^第[一二三四五六七八九十百]+章\s*·\s*/, '')}</em>}
      </section>
    </>
  );
}

/** 疑点: an open one sealed 疑 with where to look, a proven one 实. */
export function Leads({ leads, disabled = false, onFollow }: {
  leads: PlayLead[]; disabled?: boolean; onFollow?: (lead: PlayLead) => void;
}) {
  if (!leads.length) return null;
  return (
    <section className={styles.part} aria-label="疑点">
      <Sub>疑点</Sub>
      <ul className={styles.rows}>
        {leads.map((lead) => (
          <li key={lead.id} data-proven={lead.proven ? '' : undefined}>
            <Seal glyph={lead.proven ? '实' : '疑'} tone={lead.proven ? 'cin' : 'gold'} />
            <span className={styles.what}>
              <span>{lead.text}</span>
              {lead.chapter && <small>{lead.chapter}</small>}
            </span>
            {lead.proven ? <em className={styles.proven}>已查实</em> : (
              lead.action && onFollow ? (
                <button type="button" className={styles.whereButton} disabled={disabled}
                  aria-label={`${leadActionLabel(lead)}：${lead.where || lead.text}`}
                  onClick={() => onFollow(lead)}>
                  {lead.where && <span>{lead.where}</span>}
                  <b>{leadActionLabel(lead)}</b>
                </button>
              ) : lead.where && <em className={styles.where}>{lead.where}</em>
            )}
            <span className="visually-hidden">{lead.proven ? '，已查实' : '，未查'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 因果: 恩 and 诺 in cinnabar, 怨 and 债 in a gold frame; who, what, how it may come back, a 诺's day. */
export function Karma({ karma }: { karma: PlayKarma[] }) {
  if (!karma.length) return null;
  return (
    <section className={styles.part} aria-label="因果">
      <Sub>因果</Sub>
      <ul className={styles.rows}>
        {karma.map((entry) => {
          const state = karmaState(entry);
          return (
            <li key={entry.id} data-settled={entry.done || entry.broken ? '' : undefined}>
              <Seal glyph={entry.kind} tone={entry.done ? 'faint' : KARMA_TONE[entry.kind]} />
              <span className={styles.what}>
                <span>
                  <b>{entry.who}</b>
                  {entry.what}
                </span>
                <small>{entry.back}</small>
              </span>
              {state && (
                <em className={entry.broken ? styles.broken : entry.done ? styles.done : styles.due}>{state}</em>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** 心结: each takes one off a gate's odds, three at most; at 结丹 and 元婴 each is a beat of 心魔. */
export function Knots({ knots }: { knots: PlayKnot[] }) {
  if (!knots.length) return null;
  return (
    <section className={styles.part} aria-label="心结">
      <Sub>心结</Sub>
      <p className={styles.note}>每桩心结冲关时减一，最多减三；到结丹、元婴，每桩都是一拍心魔。</p>
      <ul className={styles.rows}>
        {knots.map((knot) => (
          <li key={knot.id}>
            <Seal glyph="结" tone="cin" />
            <span className={styles.what}>
              <span>
                <b>{knot.kind}</b>
                {knot.what}
              </span>
              <small>{knot.who}</small>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
