// The end of a life in extreme mode (the old page's alert 「你已死亡，一切归零」): a card of its own at
// the end of the fatal turn. The save has already started over from its opening on the server;
// 重入轮回 reads it again, and the book then holds only the new life. Until then nothing else is
// written: the input waits (endsInDeath).
import type { Block, DeathBlock } from '../../contracts';
import { Btn } from '../../ui/Btn';
import { Seal, Stamp } from '../../ui/Marks';
import styles from './DeathCard.module.css';

/** The page's words in the interface's punctuation: 「……」 for its 「...」. */
function said(text: string): string {
  return text.replace(/\.{3}$/, '……');
}

export function DeathCard({ block, onRestart }: { block: DeathBlock; onRestart?: () => void }) {
  return (
    <div className={styles.card} role="group" aria-label="身死道消">
      <Seal glyph="陨" />
      <div className={styles.body}>
        <strong>身死道消</strong>
        <span className={styles.line}>{said(block.text)}</span>
        <span className={styles.count}>第 {block.deaths} 次身死</span>
        {onRestart && (
          <span className={styles.actions}>
            <Btn variant="solid" onClick={onRestart}>
              重入轮回
            </Btn>
          </span>
        )}
      </div>
      <Stamp glyph="终" label="终" />
    </div>
  );
}

/** Whether a turn ended a life: nothing is sent after it until the save is read again. */
export function endsInDeath(turn: { blocks: readonly Block[] } | undefined): boolean {
  return turn?.blocks.some((block) => block.type === 'death') ?? false;
}
