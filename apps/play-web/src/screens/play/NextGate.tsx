// 下一关 (gameplay plan item 24; the mock-up's .fx-gate): a small card at the end of the days on the book
// page, from the state view's gate in brief: the gate's name, what is still missing (in cinnabar), the
// foundation and the odds; and, when something other than the missing 修为 holds the way up (an injury
// that keeps 修炼 waiting), that reason on a line of its own. Pressed whole, it opens the gate's
// preparation sheet.
import type { PlayGate } from '../../contracts';
import { oddsWords } from '../../ui/Acts';
import styles from './NextGate.module.css';

export interface NextGateProps {
  gate: PlayGate;
  onOpen: () => void;
  /** what holds the way up besides 修为 (修炼's own reason when it waits: 「内伤未愈，还要养八日」) */
  blocked?: string;
}

/** What a screen reader hears for the card. */
export function nextGateLabel(gate: PlayGate, blocked?: string): string {
  const missing = gate.missing.length ? `还缺${gate.missing.join('、')}，` : '';
  return `下一关 · ${gate.name}：${missing}预计根基${gate.foundation}，成算${oddsWords(gate.odds)}。${blocked ? `${blocked}。` : ''}打开准备单`;
}

export function NextGate({ gate, onOpen, blocked }: NextGateProps) {
  return (
    <button type="button" className={styles.gate} aria-label={nextGateLabel(gate, blocked)} onClick={onOpen}>
      <span className={styles.kind} aria-hidden="true">
        <span>关</span>
      </span>
      <span className={styles.words} aria-hidden="true">
        <strong>下一关 · {gate.name}</strong>
        <small>
          {gate.missing.map((miss) => (
            <u key={miss}>{miss}</u>
          ))}
          <span>
            预计根基 <b>{gate.foundation}</b>
          </span>
          <span>
            成算 <b data-tone={gate.odds >= 60 ? 'good' : gate.odds < 30 ? 'poor' : undefined}>{oddsWords(gate.odds)}</b>
          </span>
        </small>
        {blocked && <em className={styles.blocked}>{blocked}</em>}
      </span>
    </button>
  );
}
