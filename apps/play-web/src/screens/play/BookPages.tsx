// The book's own pages in the cultivation life (章回, gameplay plan item 38): the closing page of a
// volume (卷末语) and what the world did while the player was away for years (出关见闻). Both read as a
// journey's passage does (Passage.tsx; 玩法设计「卷末语和出关见闻沿用赶路过场的样子」): the page goes to ink
// around a line in gold under a short gold rule, a few big brush characters, a line of small words,
// and under them the lines, a gold diamond each. A volume's page ends with the volume it turns to.
import type { Block, BookLine, EmergeBlock, VolumeBlock } from '../../contracts';
import { bareLine, dayWords, spanWords, volumeWords } from '../../lib/book';
import { chineseNumber } from '../../lib/numerals';
import styles from './BookPages.module.css';

/** The line over a closed volume: what closed it. */
export function volumeLead(block: Pick<VolumeBlock, 'cause' | 'name'>): string {
  if (!block.name) return '这一卷到此为止';
  return block.cause === 'event' ? `${block.name}，尘埃落定` : `过了${block.name}这一关`;
}

function Lines({ lines, dated, label }: { lines: readonly BookLine[]; dated?: boolean; label: string }) {
  return (
    <ul className={styles.lines} aria-label={label}>
      {lines.map((line, at) => (
        <li key={at}>
          {dated && line.date && <time>{dayWords(line.date)}</time>}
          {line.text}
        </li>
      ))}
    </ul>
  );
}

/**
 * A volume's closing page: what closed it, 「卷二终」, the days it spans, the annals the engine picked
 * from it (with their days), the words written for it, and 「翻到卷三」. A great event's volume has the
 * aftermath's line for its words: the same line among the annals is left out.
 */
export function VolumePage({ block }: { block: VolumeBlock }) {
  const span = spanWords(block.since, block.until);
  const words = block.text?.trim() ?? '';
  const annals = words ? block.annals.filter((line) => bareLine(line.text) !== bareLine(words)) : block.annals;
  return (
    <section className={styles.page} data-book-page="volume" aria-label={`${volumeWords(block.no)}终`}>
      <p className={styles.lead}>{volumeLead(block)}</p>
      <h3 className={styles.big}>{volumeWords(block.no)}终</h3>
      {span && <p className={styles.span}>{span}</p>}
      {annals.length > 0 && <Lines lines={annals} dated label="这一卷的年谱" />}
      {words && <p className={styles.words}>{words}</p>}
      <p className={styles.next}>翻到{volumeWords(block.next)}</p>
    </section>
  );
}

/** 出关见闻: how many years went by, 「出关」, the days, and what the world did meanwhile. */
export function EmergePage({ block }: { block: EmergeBlock }) {
  const span = spanWords(block.since, block.until);
  return (
    <section className={styles.page} data-book-page="emerge" aria-label="出关见闻">
      <p className={styles.lead}>{chineseNumber(block.years)}载光阴，弹指而过</p>
      <h3 className={styles.big}>出关</h3>
      {span && <p className={styles.span}>{span}</p>}
      {block.lines.length > 0 ? (
        <Lines lines={block.lines} label="这些年世上的事" />
      ) : (
        <p className={styles.quiet}>这些年世上没有什么大事。</p>
      )}
    </section>
  );
}

/**
 * A turn's blocks with the annals lines its 出关见闻 tells left out (the world line's lines of the years
 * away are both): the page says them. The newest line stays, with its 写一段.
 */
export function untold(blocks: readonly Block[]): Block[] {
  const pages = blocks.filter((block): block is EmergeBlock => block.type === 'emerge');
  if (pages.length === 0) return [...blocks];
  const said = new Set(pages.flatMap((page) => page.lines.map((line) => bareLine(line.text))));
  return blocks.filter((block) => block.type !== 'chronicle' || block.now || !said.has(bareLine(block.text)));
}
