// What a screen reader hears as a turn is written (spec 十二: new story text in an aria-live="polite"
// region): each paragraph, spoken line, card and notice of the turn being written once it is whole, and
// the options when they come. The book itself is no live region: the earlier turns fetched above it,
// and a paragraph growing word by word, would be read out as well.
import { useEffect, useRef, useState } from 'react';
import type { Block, Turn } from '../../contracts';
import { bareLine, chapterWords, coupletLines, volumeWords } from '../../lib/book';
import { chineseNumber, optionNumeral } from '../../lib/numerals';
import type { LiveTurn } from '../../store/merge';
import { cardLabel as actLabel } from '../../ui/Acts';
import { cardLabel } from '../../ui/Card';
import { perkLabel } from '../../ui/Perks';
import { pipsLabel } from '../../ui/Pips';
import { SCENE_WORD } from '../../ui/SceneMark';
import { volumeLead } from './BookPages';

/** What a block says aloud; nothing for what the book does not show as words (the player's own
 *  stroke, who arrives, where the scene moves). */
export function spoken(block: Block): string | null {
  switch (block.type) {
    case 'narration':
      return block.text.trim() || null;
    case 'speech':
      return `${block.speaker.self ? '你' : block.speaker.name}：${block.lines.join('')}`;
    case 'check':
    case 'combat':
      return cardLabel(block);
    case 'receipt': {
      const lines = block.lines.map((line) => [line.label, line.delta, line.value].filter(Boolean).join(' ')).join('，');
      return lines ? `${cardLabel(block)}：${lines}` : cardLabel(block);
    }
    case 'notice':
    case 'death':
      return block.text.trim() || null;
    case 'options':
      return block.items.length > 0
        ? `抉择：${block.items.map((item) => `${optionNumeral(item.index)}，${item.text}`).join('；')}`
        : null;
    // the cultivation life: an annals line (and the clock it moved), a scene's mark, a beat's cards, the 悟得
    case 'chronicle':
      return `年谱：${block.date}，${block.text}${block.clock ? `${block.clock.name} ${pipsLabel(block.clock.value, block.clock.size)}` : ''}`;
    case 'mark': {
      // the life's book (item 38): the scene's 回, and at its close the 回目
      const mark = `${SCENE_WORD[block.kind]}：${block.title}`;
      const hui = block.chapter ? chapterWords(block.chapter) : '';
      if (block.kind === 'open') return hui ? `${hui}，${mark}` : mark;
      const title = [hui, block.couplet ? coupletLines(block.couplet).join('，') : ''].filter(Boolean).join('：');
      return title ? `${mark}。${title}` : mark;
    }
    case 'actions':
      return block.items.length > 0
        ? `抉择：${block.items.map((item) => `${optionNumeral(item.index)}，${actLabel(item)}`).join('；')}`
        : null;
    case 'perks':
      return block.items.length > 0 ? `悟得，三条择一：${block.items.map((item) => `${optionNumeral(item.index)}，${perkLabel(item)}`).join('；')}` : null;
    // the life's book (item 38): a volume's closing page, and 出关见闻
    case 'volume':
      return `${volumeWords(block.no)}终：${volumeLead(block)}。${block.text ? `${bareLine(block.text)}。` : ''}翻到${volumeWords(block.next)}`;
    case 'emerge':
      return `出关见闻，${chineseNumber(block.years)}年：${block.lines.map((line) => line.text).join('；') || '世上没有什么大事'}`;
    default:
      return null;
  }
}

export interface Said {
  key: string;
  text: string;
}

/** The region keeps the latest few; what leaves it is never read again. */
const KEEP = 12;

/**
 * The lines said for the turns written while the page is open, the latest last: the turn being written,
 * and once it is done, the same turn as it stands, so a card its performance held back (`heldByTurn`)
 * is said when it lands in the book.
 */
export function useAnnounce(
  live: LiveTurn | null,
  last: Pick<Turn, 'no' | 'blocks'> | undefined,
  heldByTurn: ReadonlyMap<number, ReadonlySet<string>>,
): Said[] {
  const [said, setSaid] = useState<Said[]>([]);
  const heard = useRef(new Set<string>());
  const written = useRef(new Set<number>());
  if (live) written.current.add(live.no);
  const turn = live ?? (last && written.current.has(last.no) ? last : null);
  const held = turn ? heldByTurn.get(turn.no) : undefined;
  useEffect(() => {
    if (!turn) return;
    const fresh: Said[] = [];
    for (const block of turn.blocks) {
      if (held?.has(block.id)) continue;
      const text = spoken(block);
      if (!text) continue;
      // a block rewritten after a reset says its new words
      const key = `${turn.no}:${block.id}:${text}`;
      if (heard.current.has(key)) continue;
      heard.current.add(key);
      fresh.push({ key, text });
    }
    if (fresh.length > 0) setSaid((before) => [...before, ...fresh].slice(-KEEP));
  }, [turn, held]);
  return said;
}
