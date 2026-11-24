// A command's choices before it goes (PlayVerb.options): a small sheet named for the command (狩猎), a
// row each choice (一阶, 二阶: the tiers of beast this place has; for 拜访 the people here to call on; for
// 守拙 the pressure clocks), the command's note over them. A row pressed sends the command with that
// choice (狩猎's tier, the id of the one 拜访 calls on, the clock 守拙 turns back).
import type { PlayVerb, PlayVerbOption, Verb } from '../../contracts';
import { Sheet } from '../../ui/Sheet';
import styles from './VerbChoices.module.css';

/** The verb a choice sends: 狩猎's goes as its tier, 守拙's as the clock, any other's (拜访: whom) as its id. */
export function verbWith(verb: PlayVerb, option: PlayVerbOption): Verb {
  if (verb.kind === 'hunt') return { kind: 'hunt', tier: option.value };
  if (verb.kind === 'calm') return { kind: 'calm', clock: option.value };
  return { kind: verb.kind, id: option.value };
}

/** What each command's choices are called over its rows. */
const ASKED: Record<string, string> = { hunt: '猎哪一阶的妖兽', visit: '去拜访哪一位', calm: '让哪一口钟退一格' };

export function VerbChoices({ verb, onPick, onClose }: { verb: PlayVerb; onPick: (verb: Verb) => void; onClose: () => void }) {
  return (
    <Sheet title={verb.label} open fit onClose={onClose} className={styles.sheet}>
      <p className={styles.ask}>{ASKED[verb.kind] ?? '选一样'}</p>
      {verb.note && <p className={styles.note}>{verb.note}</p>}
      <ul className={styles.choices} aria-label={ASKED[verb.kind] ?? verb.label}>
        {(verb.options ?? []).map((option) => (
          <li key={option.value}>
            <button type="button" className={styles.choice} onClick={() => onPick(verbWith(verb, option))}>
              <span className={styles.d} aria-hidden="true">
                <span>{verb.glyph}</span>
              </span>
              <b>{option.label}</b>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
