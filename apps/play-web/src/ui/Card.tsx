import { Fragment, type ReactNode } from 'react';
import type { CheckBlock, CombatBlock, Modifier, ReceiptBlock } from '../contracts';
import { Mark, Seal, Stamp } from './Marks';
import styles from './Card.module.css';

const OUTCOME = {
  success: { glyph: '成', word: '成功' },
  failure: { glyph: '败', word: '失败' },
  critical_success: { glyph: '吉', word: '大成' },
  critical_failure: { glyph: '凶', word: '大败' },
} as const;

/** The receipts only the cultivation life settles: a scene's close, an attempt at a gate, the lifespan's end. */
type LifeReceipt = 'close' | 'gate' | 'legacy';

/** The seal character of each kind of receipt (spec 三, 卡片). */
export const RECEIPT_SEAL: Record<Exclude<ReceiptBlock['kind'], LifeReceipt>, string> = {
  cultivate: '修',
  breakthrough: '破',
  gain: '得',
  loss: '失',
  quest: '任',
  trade: '易',
  rest: '息',
  injury: '伤',
  stones: '石',
  skill: '技',
};

/** The cultivation life's own: 收场「收」, 冲关「关」, 大限将至 and 坐化「寿」. */
export const LIFE_RECEIPT_SEAL: Record<LifeReceipt, string> = { close: '收', gate: '关', legacy: '寿' };

const SEALS: Record<ReceiptBlock['kind'], string> = { ...RECEIPT_SEAL, ...LIFE_RECEIPT_SEAL };

const END = { win: '胜', lose: '负', flee: '遁' } as const;

/** 掷 7 ＋ 神识 3 ＝ 10 */
function Sum({ roll, modifiers, total }: { roll: number; modifiers: Modifier[]; total: number }) {
  return (
    <>
      掷 <b>{roll}</b>
      {modifiers.map((m) => (
        <span key={m.label}>
          {m.value < 0 ? ' － ' : ' ＋ '}
          {m.label} <b>{Math.abs(m.value)}</b>
        </span>
      ))}{' '}
      ＝ <b>{total}</b>
    </>
  );
}

function Shell({ left, right, label, children }: { left: ReactNode; right?: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className={styles.card} role="group" aria-label={label}>
      {left}
      <div className={styles.body}>{children}</div>
      {right ?? <span />}
    </div>
  );
}

/** What a card says in one line, as a screen reader reads it: 「判定 · 神识探查 · 大成」. */
export function cardLabel(block: CheckBlock | CombatBlock | ReceiptBlock): string {
  if (block.type === 'check') return `判定 · ${block.title} · ${OUTCOME[block.outcome].word}`;
  if (block.type === 'combat') return `交锋 · ${block.attacker.name} 对 ${block.defender.name} · ${combatWord(block)}`;
  return `结算 · ${block.title}`;
}

function combatWord(block: CombatBlock): string {
  return block.end ? { win: '胜', lose: '败', flee: '遁走' }[block.end] : block.hit ? '命中' : '落空';
}

/** A check: 卜, the sum against the difficulty, and the outcome's stamp. */
export function CheckCard({ block }: { block: CheckBlock }) {
  const outcome = OUTCOME[block.outcome];
  return (
    <Shell
      label={cardLabel(block)}
      left={<Mark glyph="卜" />}
      right={<Stamp glyph={outcome.glyph} label={outcome.word} />}
    >
      <strong>{block.title}</strong>
      <span className={styles.calc}>
        <Sum roll={block.roll} modifiers={block.modifiers} total={block.total} />
        <em>难度 {block.difficulty}</em>
      </span>
      {block.note && <span className={styles.line}>{block.note}</span>}
    </Shell>
  );
}

/** One exchange of a fight: 战, who strikes whom with what, the sum against the defence, the damage. */
export function CombatCard({ block }: { block: CombatBlock }) {
  const stamp = block.end ? END[block.end] : block.hit ? '中' : '空';
  const word = combatWord(block);
  return (
    <Shell
      label={cardLabel(block)}
      left={<Mark glyph="战" />}
      right={<Stamp glyph={stamp} label={word} />}
    >
      {/* the names and the move's parts each whole: a narrow card breaks the line between them, never
          inside 「青锋剑」 */}
      <strong>
        <span className={styles.whole}>{block.attacker.name}</span> 对 <span className={styles.whole}>{block.defender.name}</span>
        {block.move.split(' · ').map((part, index) => (
          <Fragment key={index}>
            {' · '}
            <span className={styles.whole}>{part}</span>
          </Fragment>
        ))}
      </strong>
      <span className={styles.calc}>
        <Sum roll={block.roll} modifiers={block.modifiers} total={block.total} />
        <em>闪避 {block.defense}</em>
      </span>
      {(block.damage !== undefined || block.defenderHp) && (
        <span className={styles.line}>
          {block.damage !== undefined && (
            <>
              伤害 <b>{block.damage}</b>
            </>
          )}
          {block.damage !== undefined && block.defenderHp && '　'}
          {block.defenderHp && (
            <>
              {/* the foe's blood is 对手气血; when the foe strikes back it is the player's own (item 73's walkthrough) */}
              {block.defender.charId === 'B1' ? '气血' : '对手气血'} {block.defenderHp.current} / {block.defenderHp.max}
            </>
          )}
        </span>
      )}
    </Shell>
  );
}

/** A settlement: its seal, its title, one line per change with the numbers in bold. */
export function ReceiptCard({ block }: { block: ReceiptBlock }) {
  return (
    <Shell label={cardLabel(block)} left={<Seal glyph={SEALS[block.kind]} />}>
      <strong>{block.title}</strong>
      {block.lines.map((line, index) => (
        <span key={`${line.label}-${index}`} className={styles.line}>
          {line.label}{' '}
          {line.delta ? (
            <>
              <b>{line.delta}</b>
              {line.value && `　${line.value}`}
            </>
          ) : (
            line.value && <b>{line.value}</b>
          )}
        </span>
      ))}
    </Shell>
  );
}

/** The card for a check, a clash or a receipt block. */
export function Card({ block }: { block: CheckBlock | CombatBlock | ReceiptBlock }) {
  if (block.type === 'check') return <CheckCard block={block} />;
  if (block.type === 'combat') return <CombatCard block={block} />;
  return <ReceiptCard block={block} />;
}
