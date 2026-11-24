// 入秘境 (gameplay plan item 32): where the player's place is a secret realm's entrance (play.place.realm, the
// engine's realm.entrance), a card at the end of the days, as the next gate's is: 「入秘境 · 沉钟泽」 and a
// line of small words. Open today, it is pressed to go in as a turn (step { action: 'enter', realm }) and
// says the day it closes; closed, it says the day it opens next and is not pressed; open but barred (this
// opening entered already, the realm or the identity it asks for), it says why, and pressed says it again.
import type { PlaceRealm, PlayDate, PlayView } from '../../contracts';
import { useUiStore } from '../../store/ui';
import { yearWords } from '../sheets/Calendar';
import styles from './NextGate.module.css';

/** The realm whose entrance is here, while the player is not inside one; else null. */
export function realmHere(play: PlayView | null | undefined): PlaceRealm | null {
  if (!play || play.realm) return null;
  return play.place?.realm ?? null;
}

/** A day of the realm's: 五月初十, or 明年五月初五 when it falls in another year than today's. */
function dayWords(date: PlayDate, today?: PlayDate | null): string {
  return today && date.year !== today.year ? `${yearWords(date.year, today.year)}${date.text}` : date.text;
}

/** The small words of the card: open and its closing day, closed and the day it opens, or why it is barred. */
export function realmWords(realm: PlaceRealm, today?: PlayDate | null): string[] {
  if (!realm.open) return realm.next ? ['今日没开', `${dayWords(realm.next, today)}开启`] : [realm.note ?? '今日没开'];
  if (realm.off) return [realm.note ?? '眼下进不去'];
  return ['今日开着', realm.until ? `${dayWords(realm.until, today)}关闭` : '到期关闭'];
}

/** What a screen reader hears for the card. */
export function realmLabel(realm: PlaceRealm, today?: PlayDate | null): string {
  const words = realmWords(realm, today).join('，');
  return `入秘境 · ${realm.name}：${words}${realm.open && !realm.off ? '。进去' : ''}`;
}

export function RealmGate({
  realm,
  today,
  onEnter,
  disabled = false,
}: {
  realm: PlaceRealm;
  today?: PlayDate | null;
  onEnter: () => void;
  disabled?: boolean;
}) {
  const notify = useUiStore((s) => s.notify);
  const words = realmWords(realm, today);
  const inner = (
    <>
      <span className={styles.kind} aria-hidden="true">
        <span>秘</span>
      </span>
      <span className={styles.words} aria-hidden="true">
        <strong>入秘境 · {realm.name}</strong>
        {realm.open && realm.off ? (
          <em className={styles.blocked}>{words[0]}</em>
        ) : (
          <small>
            {words.map((word) => (
              <span key={word}>{word}</span>
            ))}
          </small>
        )}
      </span>
    </>
  );
  // closed: the card only says when it opens
  if (!realm.open) {
    return (
      <p className={styles.gate} data-closed="" role="note" aria-label={realmLabel(realm, today)}>
        {inner}
      </p>
    );
  }
  return (
    <button
      type="button"
      className={styles.gate}
      aria-label={realmLabel(realm, today)}
      aria-disabled={realm.off || undefined}
      disabled={disabled}
      onClick={() => (realm.off ? notify(`入秘境：${realm.note ?? '眼下进不去'}`) : onEnter())}
    >
      {inner}
    </button>
  );
}
