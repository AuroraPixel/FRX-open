// 秘境的节点图 (gameplay plan item 32; the design's 六「秘境」 and 十四: 走过的、能选的、看不清的分开画):
// at the end of the days on the book page while the player is inside a secret realm (view.play.realm).
// A header with the realm's name, the days left and the day it closes; then a layer a row, its nodes
// as diamonds: walked (on the path, filled), open (the next layer, gilded: each a button that takes it,
// a large one on phones), passed (a layer behind, faint) and hidden (deeper, dashed, 「？」, but the
// deepest 守). The others inside stand at the layer they reached, a mate in jade, a rival in cinnabar;
// past the deepest, 「出秘境」. A node or leaving goes as a turn: step { action: 'node', node } or
// { action: 'leave' }. What the realm gave so far closes it.
import { useId } from 'react';
import type { PlayRealm, RealmNode, RealmOther, RealmStep } from '../../contracts';
import { chineseNumber } from '../../lib/numerals';
import styles from './Realm.module.css';

/** Each kind's few words, under its glyph. */
export const NODE_WORDS: Record<string, string> = { 战: '斗法', 险: '闯关', 宝: '取宝', 歇: '调息', 秘: '探秘', 守: '看守' };

const two = (n: number) => (n === 2 ? '两' : chineseNumber(n));

/** 「余七日」, 「今日关闭」 */
export function daysLeftWords(days: number): string {
  return days <= 0 ? '今日关闭' : `余${two(days)}日`;
}

/** What a screen reader hears for a node. */
export function nodeLabel(node: RealmNode, layer: number): string {
  const where = `第${chineseNumber(layer)}层`;
  const what = node.kind ? `${node.kind}，${NODE_WORDS[node.kind] ?? ''}` : '看不清';
  const state = { walked: '走过', open: '能选', passed: '没走', hidden: '还远' }[node.state];
  return `${where}，${what}，${state}`;
}

/**
 * The others standing at a row: a layer (1 up to the depth) holds those who have walked that many; one
 * who has walked them all stands at the exit (row depth + 1), and nobody waits at the deepest itself.
 */
export function standing(others: readonly RealmOther[], row: number, depth: number): RealmOther[] {
  return others.filter((other) => (row > depth ? other.layer >= depth : row < depth && other.layer === row));
}

function Others({ others }: { others: RealmOther[] }) {
  if (!others.length) return null;
  return (
    <span className={styles.others}>
      {others.map((other) => (
        <i key={other.id} data-side={other.side}>
          <span className="visually-hidden">{other.side === 'mate' ? '同门' : '对头'}</span>
          {other.name}
        </i>
      ))}
    </span>
  );
}

export interface RealmMapProps {
  realm: PlayRealm;
  /** a step taken; without it the map only shows */
  onStep?: (step: RealmStep) => void;
  /** a turn is being written, or a fight or a scene inside holds the next step */
  disabled?: boolean;
}

export function RealmMap({ realm, onStep, disabled = false }: RealmMapProps) {
  const titleId = useId();
  const taken = realm.taken.map((item) => `${item.name}${two(item.count)}`).join('、');
  const live = Boolean(onStep) && !disabled;
  return (
    <section className={styles.realm} aria-labelledby={titleId}>
      <header className={styles.head}>
        <h3 id={titleId}>{realm.name}</h3>
        <p>
          <b>{daysLeftWords(realm.daysLeft)}</b>
          <span>{realm.until.text}关闭</span>
          <span>
            {realm.exit ? '已到最深处' : `第${chineseNumber(Math.min(realm.at + 1, realm.depth))}层`} · 共{chineseNumber(realm.depth)}层
          </span>
        </p>
      </header>
      <ol className={styles.layers} aria-label="节点图">
        {realm.layers.map((layer, at) => (
          <li key={at} className={styles.layer} data-at={at < realm.at ? 'behind' : at === realm.at ? 'next' : 'ahead'}>
            <span className={styles.depth} aria-hidden="true">
              {chineseNumber(at + 1)}
            </span>
            <span className={styles.nodes}>
              {layer.map((node) =>
                node.state === 'open' && onStep ? (
                  <button
                    key={node.id}
                    type="button"
                    className={styles.node}
                    data-state="open"
                    aria-label={nodeLabel(node, at + 1)}
                    disabled={!live}
                    onClick={() => onStep({ action: 'node', node: node.id })}
                  >
                    <span className={styles.d} aria-hidden="true">
                      <span>{node.glyph ?? '？'}</span>
                    </span>
                    <small aria-hidden="true">{node.kind ? NODE_WORDS[node.kind] : ''}</small>
                  </button>
                ) : (
                  <span key={node.id} className={styles.node} data-state={node.state} role="img" aria-label={nodeLabel(node, at + 1)}>
                    <span className={styles.d} aria-hidden="true">
                      <span>{node.glyph ?? '？'}</span>
                    </span>
                    <small aria-hidden="true">{node.kind && node.state !== 'hidden' ? NODE_WORDS[node.kind] : ''}</small>
                  </span>
                ),
              )}
            </span>
            <Others others={standing(realm.others, at + 1, realm.depth)} />
          </li>
        ))}
        <li className={styles.layer} data-at={realm.exit ? 'next' : 'ahead'} data-exit="">
          <span className={styles.depth} aria-hidden="true">
            出
          </span>
          <span className={styles.nodes}>
            {realm.exit && onStep ? (
              <button type="button" className={styles.leave} disabled={!live} onClick={() => onStep({ action: 'leave' })}>
                出秘境
              </button>
            ) : (
              <span className={styles.exitWord}>出口</span>
            )}
          </span>
          <Others others={standing(realm.others, realm.depth + 1, realm.depth)} />
        </li>
      </ol>
      {taken && (
        <p className={styles.taken}>
          <b>所得</b>
          {taken}
        </p>
      )}
    </section>
  );
}
