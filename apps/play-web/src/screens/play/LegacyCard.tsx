// 传承 (gameplay plan item 49): while the protagonist who died of old age waits for an heir, a card at the
// end of the days on the book page, after the death's own blocks: who died, where and at what age, and
// that the way goes on in an heir. Pressed whole, it opens the choice (the legacy panel).
import type { PlayLegacy } from '../../contracts';
import { chineseNumber } from '../../lib/numerals';
import styles from './LegacyCard.module.css';

/** 「陆沉坐化于观云台，享年二百。」 */
export function passingWords(legacy: PlayLegacy): string {
  const where = legacy.place ? `于${legacy.place}` : '';
  const age = legacy.age !== undefined ? `，享年${chineseNumber(legacy.age)}` : '';
  return `${legacy.name ?? '你'}坐化${where}${age}。`;
}

export function LegacyCard({ legacy, onOpen }: { legacy: PlayLegacy; onOpen: () => void }) {
  const heirs = legacy.heirs?.length ?? 0;
  const way = heirs ? `${heirs === 1 ? '一位' : heirs === 2 ? '两位' : `${chineseNumber(heirs)}位`}可以接着走，或另立后人` : '另立一个后人接着走';
  return (
    <button type="button" className={styles.card} aria-label={`寿元已尽：${passingWords(legacy)}${way}。定下传承`} onClick={onOpen}>
      <span className={styles.kind} aria-hidden="true">
        <span>传</span>
      </span>
      <span className={styles.words} aria-hidden="true">
        <strong>寿元已尽 · 定下传承</strong>
        <small>{passingWords(legacy)}</small>
        <em>{way}。</em>
      </span>
    </button>
  );
}
