// The arrays of a fight (gameplay plan item 43; PlayFight.arrays), over its commands: a small tag each, the
// player's side marked 我 in gold and the foes' 敌 in cinnabar, its name, tier and the rounds its stones
// still last (阵力减半 when it was laid badly, 已散 once they are burnt). 破 (move break) stands among the
// commands while the foes' array does.
import type { FightArray } from '../../contracts';
import { chineseNumber } from '../../lib/numerals';
import styles from './FightArrays.module.css';

/** 「一阶 · 十回合」, 「一阶 · 两回合 · 阵力减半」, 「一阶 · 已散」 */
export function fightArrayWords(array: FightArray): string {
  const left = array.rounds > 0 ? `${array.rounds === 2 ? '两' : chineseNumber(array.rounds)}回合` : '已散';
  return [array.tier, left, array.power < 1 && array.rounds > 0 ? '阵力减半' : ''].filter(Boolean).join(' · ');
}

export function FightArrays({ arrays }: { arrays: readonly FightArray[] }) {
  if (!arrays.length) return null;
  return (
    <ul className={styles.arrays} aria-label="阵">
      {arrays.map((array) => (
        <li
          key={array.id}
          className={styles.array}
          data-side={array.side}
          data-gone={array.rounds > 0 ? undefined : ''}
          aria-label={`${array.side === 'player' ? '我方' : '对手'}的${array.label}，${fightArrayWords(array)}`}
        >
          <b aria-hidden="true">{array.side === 'player' ? '我' : '敌'}</b>
          <span aria-hidden="true">{array.label}</span>
          <small aria-hidden="true">{fightArrayWords(array)}</small>
        </li>
      ))}
    </ul>
  );
}
